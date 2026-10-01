import { t } from "@/i18n";
import { api } from "@/lib/api";
import { buildTestCommand, testScriptName, type TestTarget } from "@/lib/test-commands";
import type { TestResult, TestSuite } from "@/lib/types";
import { getState, setState, subscribe } from "@/state/store";
import { runScript, runningScriptTab, scriptKey, scriptTabOf } from "@/state/terminals";

export type TestStatus = TestResult["status"] | "running" | "unknown";

/** Clé d'un test : son fichier, ses blocs et son nom, comme le serveur la calcule. */
export function testKey(path: string, parents: readonly string[], name: string): string {
  return [path, ...parents, name].join(" › ");
}

/** Chemin absolu d'un fichier d'une suite, séparé à la Windows. */
export function suiteFile(suite: TestSuite, path: string): string {
  return `${suite.directory.replace(/[\\/]+$/, "")}\\${path.split("/").join("\\")}`;
}

/** Clé du script d'une suite : son onglet, et son lancement en cours. */
export function suiteScript(suite: TestSuite): string {
  return scriptKey(suite.directory, testScriptName(suite.framework));
}

const loading = new Map<string, Promise<void>>();

/** Relit les suites d'un projet ; les résultats connus viennent avec. */
export function loadTests(root: string): Promise<void> {
  const pending = api<{ suites: TestSuite[] }>("/api/tests", { root })
    .then(({ suites }) => setState((current) => ({ tests: { ...current.tests, [root]: suites } })))
    .finally(() => loading.delete(root));
  loading.set(root, pending);
  return pending;
}

/** Les suites d'un projet, chargées au premier besoin. */
export function ensureTests(root: string): void {
  if (!getState().tests[root] && !loading.has(root)) void loadTests(root).catch(() => undefined);
}

/** Statut d'un test : en cours s'il fait partie du lancement qui tourne, sinon son dernier résultat. */
export function statusOf(suite: TestSuite, path: string, parents: readonly string[], name: string): TestStatus {
  const target = getState().testRuns[suiteScript(suite)];
  if (target && (!target.path || (target.path === path && (!target.name || testKey(path, target.parents ?? [], target.name) === testKey(path, parents, name))))) {
    return "running";
  }
  return suite.results.find((result) => testKey(result.path, result.parents, result.name) === testKey(path, parents, name))?.status ?? "unknown";
}

export function resultOf(suite: TestSuite, path: string, parents: readonly string[], name: string): TestResult | undefined {
  return suite.results.find((result) => testKey(result.path, result.parents, result.name) === testKey(path, parents, name));
}

/** Suivi d'un lancement : l'onglet doit passer par « en cours » avant qu'on lise son rapport. */
interface Launch {
  root: string;
  suite: TestSuite;
  target: TestTarget;
  since: number;
  seenRunning: boolean;
}

const launches = new Map<string, Launch>();
/** Dernière cible lancée de chaque suite, par clé de script : ce que relancer reprend. */
const lastTargets = new Map<string, TestTarget>();

/** Nom de script qui désigne l'onglet d'une suite de tests. */
export function isSuiteScript(name: string): boolean {
  return name === testScriptName("vitest") || name === testScriptName("pytest");
}

/**
 * Relance la suite dont `key` est la clé de script, sur sa dernière cible — toute
 * la suite après un rechargement. Passer par `runTests` fait revenir les résultats
 * dans la vue Tests et dans la marge, ce que retaper la commande ne ferait pas.
 * Faux si aucune suite du projet ne porte cette clé.
 */
export async function rerunSuite(root: string, key: string): Promise<boolean> {
  if (!getState().tests[root]) await loadTests(root).catch(() => undefined);
  const suite = getState().tests[root]?.find((item) => suiteScript(item) === key);
  if (!suite) return false;
  runTests(root, suite, lastTargets.get(key) ?? {}, { focus: false });
  return true;
}
const noticeListeners = new Set<(message: string | undefined) => void>();

/** Un message sur le dernier lancement : rapport manquant, erreur du serveur. */
export function watchTestNotice(listener: (message: string | undefined) => void): () => void {
  noticeListeners.add(listener);
  return () => noticeListeners.delete(listener);
}

function notify(message: string | undefined): void {
  for (const listener of noticeListeners) listener(message);
}

/**
 * Lance une suite, un fichier ou un test dans l'onglet de la suite. Refusé tant
 * que cet onglet fait tourner autre chose. `focus: false` laisse l'onglet en
 * arrière-plan : lancé depuis la marge, le résultat s'y voit.
 */
export function runTests(root: string, suite: TestSuite, target: TestTarget = {}, options: { focus?: boolean } = {}): void {
  const name = testScriptName(suite.framework);
  // Claude dans l'onglet de la suite : rien ne s'y lance, et rien n'est à suivre.
  if (runningScriptTab(suite.directory, name) || scriptTabOf(suite.directory, name)?.kind === "claude") return;
  const key = suiteScript(suite);
  lastTargets.set(key, target);
  launches.set(key, { root, suite, target, since: Date.now(), seenRunning: false });
  setState((current) => ({ testRuns: { ...current.testRuns, [key]: target } }));
  notify(undefined);
  runScript(name, suite.directory, buildTestCommand(suite.framework, suite.reportPath, target), { ...options, root });
}

function finish(key: string, launch: Launch): void {
  launches.delete(key);
  setState((current) => {
    const testRuns = { ...current.testRuns };
    delete testRuns[key];
    return { testRuns };
  });
  const { root, suite, target, since } = launch;
  const only = target.path && target.name ? { only: testKey(target.path, target.parents ?? [], target.name) } : {};
  api<{ results: TestResult[]; stale?: boolean }>("/api/tests/results", { directory: suite.directory, framework: suite.framework, since: String(since), ...only })
    .then((answer) => {
      setState((current) => ({
        tests: {
          ...current.tests,
          [root]: (current.tests[root] ?? []).map((item) => (suiteScript(item) === key && item.framework === suite.framework ? { ...item, results: answer.results } : item)),
        },
      }));
      notify(answer.stale ? t("Aucun rapport de test n'a été écrit : regarde la sortie dans l'onglet.") : undefined);
    })
    .catch((caught: unknown) => notify((caught as Error).message));
}

// La fin d'une commande de test se voit à l'état de son onglet : on relit alors le rapport.
subscribe(() => {
  if (launches.size === 0) return;
  const { terminals } = getState();
  for (const [key, launch] of launches) {
    const tab = Object.values(terminals).find((entry) => entry.owner === launch.root && entry.info.script === key && (!entry.info.exited || launch.seenRunning))?.info;
    if (!tab) continue;
    if (tab.state === "running" && !tab.exited) {
      launch.seenRunning = true;
      continue;
    }
    if (!launch.seenRunning && !tab.exited) continue;
    // Hors de la notification en cours : `finish` change l'état à son tour.
    queueMicrotask(() => launches.get(key) === launch && finish(key, launch));
  }
});
