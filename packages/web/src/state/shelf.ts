/**
 * Gestes de l'onglet Scripts : y entrer et en sortir, y ranger un shell ou en
 * sortir un terminal, relancer un script, arrêter ou fermer en nombre, replier
 * un groupe.
 *
 * Vit à part de `terminals.ts` parce que relancer une suite de tests passe par
 * `tests.ts`, qui dépend lui-même de `terminals.ts`.
 */

import { backTarget, natureOf, selectedScript, splitScriptKey, type Nature, type Placement } from "@/lib/script-shelf";
import type { TerminalInfo } from "@/lib/types";
import { activeProject, getState, scriptsShown, setState, subscribe, tabsOf, type State } from "@/state/store";
import { isSuiteScript, rerunSuite } from "@/state/tests";
import { closeTerminal, focusTerminal, interruptTerminal, resize, runScript } from "@/state/terminals";

/** Temps laissé à un script arrêté pour rendre la main avant qu'on le relance. */
const STOP_TIMEOUT_MS = 10_000;

/** Terminaux dont la relance attend la fin de ce qui y tournait : un second clic n'en lance pas une autre. */
const restarting = new Set<string>();

/**
 * Entre dans l'onglet Scripts, sur le script retenu, ou en sort vers ce qu'on
 * regardait dans la barre. Sans rien à rendre dans la barre, l'accueil s'affiche.
 */
export function toggleScripts(): void {
  const current = getState();
  const project = activeProject(current);
  if (!project) return;
  const { bar, shelf } = tabsOf(current, project.root);
  if (!scriptsShown(current)) {
    const id = selectedScript(project.scripts, shelf.map((info) => info.id));
    if (id) focusTerminal(id);
    return;
  }
  const back = backTarget(
    project.scripts,
    bar.map((info) => info.id),
    project.openFiles,
  );
  // Le projet retient ce vers quoi on sort, l'accueil compris : y revenir ne
  // rentre pas dans l'onglet Scripts qu'on vient de quitter.
  setState((state) => ({
    activeTerminalId: back.tab,
    followLive: true,
    projects: state.projects.map((item) => (item.root === project.root ? { ...item, activeTab: back.tab, activeFile: back.file } : item)),
  }));
  const tab = back.tab;
  if (tab && !back.file) requestAnimationFrame(() => resize(tab));
}

/** Commande retenue pour le terminal `id`, s'il en a une. */
function commandOf(current: State, id: string): string | undefined {
  const owner = current.terminals[id]?.owner;
  return current.projects.find((project) => project.root === owner)?.scripts.commands[id];
}

/**
 * Le terminal se relance : il porte un script dont on connaît la commande, ou une
 * suite de tests. Un shell sans script, ou un onglet où Claude tourne, ne se
 * relance pas.
 */
export function canRelaunch(current: State, info: TerminalInfo): boolean {
  if (!info.script || info.kind === "claude") return false;
  return commandOf(current, info.id) !== undefined || isSuiteScript(splitScriptKey(info.script).name);
}

/** Attend que le terminal ait fini ce qu'il faisait ; faux s'il se ferme ou si l'attente dure trop. */
function stopped(id: string, timeout: number): Promise<boolean> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe = () => {};
    let done = false;
    const finish = (value: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(value);
    };
    const check = () => {
      const entry = getState().terminals[id];
      if (!entry) finish(false);
      else if (entry.info.state !== "running" || entry.info.exited) finish(true);
    };
    timer = setTimeout(() => finish(false), timeout);
    unsubscribe = subscribe(check);
    check();
  });
}

/**
 * Relance le script d'un terminal sans changer ce qu'on regarde.
 *
 * En cours, il est d'abord arrêté par Ctrl+C, et relancé une fois la main
 * rendue ; une invite qui retient le shell (« Terminer le programme de
 * commandes ? ») fait renoncer au bout de dix secondes. Une suite de tests repasse
 * par `runTests`. Un shell terminé laisse la place à un nouvel onglet, montré à la
 * sienne s'il l'était.
 */
export async function relaunch(id: string): Promise<void> {
  const initial = getState().terminals[id];
  if (!initial || !canRelaunch(getState(), initial.info) || restarting.has(id)) return;
  const owner = initial.owner;
  if (initial.info.state === "running" && !initial.info.exited) {
    restarting.add(id);
    interruptTerminal(id, { show: false });
    const ready = await stopped(id, STOP_TIMEOUT_MS);
    restarting.delete(id);
    if (!ready) return;
  }
  const entry = getState().terminals[id];
  if (!entry?.info.script) return;
  const key = entry.info.script;
  const { directory, name } = splitScriptKey(key);
  const command = commandOf(getState(), id);
  // Un shell terminé ne reprend rien : le relancer ouvre un nouvel onglet.
  const shown = entry.info.exited && getState().activeTerminalId === id;
  if (entry.info.exited) closeTerminal(id);
  if (isSuiteScript(name) && (await rerunSuite(owner, key))) return;
  if (command) runScript(name, directory, command, { focus: shown, root: owner });
}

/** Scripts en cours d'un projet : des shells, une session Claude n'en est pas un. */
function runningScripts(current: State, root: string): TerminalInfo[] {
  return tabsOf(current, root).shelf.filter((info) => info.kind === "shell" && info.state === "running" && !info.exited);
}

/** Ctrl+C dans chaque script en cours du projet actif, sans changer de script montré. */
export function stopAllScripts(): void {
  const current = getState();
  if (!current.activeRoot) return;
  for (const info of runningScripts(current, current.activeRoot)) interruptTerminal(info.id, { show: false });
}

/**
 * Scripts finis du projet actif : arrêtés, échoués ou dont le shell s'est
 * terminé. Un shell rangé à la main, revenu à son prompt, n'en est pas un : il
 * attend qu'on y tape.
 */
export function finishedScripts(current: State = getState()): TerminalInfo[] {
  if (!current.activeRoot) return [];
  return tabsOf(current, current.activeRoot).shelf.filter(
    (info) => info.kind === "shell" && (info.exited || (info.script !== undefined && info.state !== "running")),
  );
}

export function closeFinishedScripts(): void {
  for (const info of finishedScripts()) closeTerminal(info.id);
}

export function hasRunningScripts(current: State = getState()): boolean {
  return current.activeRoot !== null && runningScripts(current, current.activeRoot).length > 0;
}

/**
 * Range un terminal dans l'onglet Scripts, ou l'en sort vers la barre. Le
 * terminal montré reste montré, à sa nouvelle place ; rangé, il devient le
 * script que l'onglet Scripts retient, et son groupe se déplie.
 */
export function place(id: string, placement: Placement): void {
  setState((current) => {
    const entry = current.terminals[id];
    if (!entry) return {};
    return {
      projects: current.projects.map((project) => {
        if (project.root !== entry.owner) return project;
        const scripts = { ...project.scripts, placed: { ...project.scripts.placed, [id]: placement } };
        if (placement === "scripts") {
          scripts.selected = id;
          scripts.folded = scripts.folded.filter((nature) => nature !== natureOf(entry.info));
        }
        return { ...project, scripts };
      }),
    };
  });
  requestAnimationFrame(() => resize(id, { focus: false }));
}

/** Replie ou déplie un groupe de la liste, pour le projet actif. */
export function toggleFolded(nature: Nature): void {
  setState((current) => ({
    projects: current.projects.map((project) =>
      project.root === current.activeRoot
        ? {
            ...project,
            scripts: {
              ...project.scripts,
              folded: project.scripts.folded.includes(nature)
                ? project.scripts.folded.filter((item) => item !== nature)
                : [...project.scripts.folded, nature],
            },
          }
        : project,
    ),
  }));
}
