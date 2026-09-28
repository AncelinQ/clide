import type * as Monaco from "monaco-editor";

import { t } from "@/i18n";
import { api } from "@/lib/api";
import { runnableLines, type RunnableLine } from "@/lib/runnables";
import { testScriptName } from "@/lib/test-commands";
import type { ProjectScripts } from "@/lib/types";
import { ownerOf } from "@/lib/workspace";
import { getState, subscribe } from "@/state/store";
import { interruptTerminal, runScript, runningScriptTab } from "@/state/terminals";
import { ensureTests, loadTests, runTests, statusOf } from "@/state/tests";

/**
 * Boutons lancer / arrêter dans la marge de l'éditeur, sur chaque ligne qui se
 * lance (`runnableLines`). Ils passent par `runScript` et `runTests` : même
 * onglet par script, même arrêt par Ctrl+C, même vue « En cours ».
 */

type MonacoModule = typeof Monaco;

/** Délai après une frappe avant de relire les lignes : un Markdown change en l'écrivant. */
const TYPING_DELAY = 300;

const managers = new Map<string, { root: string; manager: string }[]>();
const loadingManagers = new Set<string>();

/** Gestionnaire du dossier d'un fichier : celui du projet ou de son dossier lié. */
function managerFor(root: string, path: string): string {
  const known = managers.get(root);
  if (!known) {
    if (!loadingManagers.has(root)) {
      loadingManagers.add(root);
      api<ProjectScripts>("/api/scripts", { root })
        .then((project) => {
          managers.set(root, [project, ...(project.linked ?? [])].map((folder) => ({ root: folder.root, manager: folder.manager })));
          refresh();
        })
        .catch(() => undefined)
        .finally(() => loadingManagers.delete(root));
    }
    return "npm";
  }
  const owner = ownerOf(path, known.map((folder) => folder.root));
  return known.find((folder) => folder.root === owner)?.manager ?? known[0]?.manager ?? "npm";
}

let editor: Monaco.editor.IStandaloneCodeEditor | undefined;
let monaco: MonacoModule | undefined;
let currentPath: () => string | undefined = () => undefined;
let decorations: Monaco.editor.IEditorDecorationsCollection | undefined;
let lines: RunnableLine[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let signature = "";

function rootOf(path: string): string | undefined {
  const { projects } = getState();
  return ownerOf(path, projects.map((project) => project.root)) ?? undefined;
}

/** Onglet où tourne une ligne, s'il y en a un. */
function runningTab(item: RunnableLine): string | undefined {
  if (item.test) return runningScriptTab(item.test.suite.directory, testScriptName(item.test.suite.framework));
  return runningScriptTab(item.directory, item.name);
}

function glyphOf(item: RunnableLine): { className: string; hover: string } {
  if (item.test) {
    const status = statusOf(item.test.suite, item.test.target.path ?? "", item.test.target.parents ?? [], item.test.target.name ?? "");
    if (status === "running") return { className: "clide-glyph clide-glyph-running", hover: t("En cours : « {name} »", { name: item.name }) };
    const tone = status === "passed" ? " clide-glyph-passed" : status === "failed" ? " clide-glyph-failed" : "";
    return { className: `clide-glyph clide-glyph-run${tone}`, hover: t("Lancer le test « {name} »", { name: item.name }) };
  }
  if (runningTab(item)) return { className: "clide-glyph clide-glyph-stop", hover: t("Arrêter « {name} » (Ctrl+C)", { name: item.name }) };
  return { className: "clide-glyph clide-glyph-run", hover: t("Lancer « {name} » dans son onglet", { name: item.name }) };
}

/** Relit les lignes du fichier montré et repose les boutons, s'ils ont changé. */
function refresh(): void {
  const path = currentPath();
  const model = editor?.getModel();
  if (!editor || !monaco || !decorations) return;
  if (!path || !model) {
    lines = [];
    signature = "";
    decorations.clear();
    return;
  }
  const root = rootOf(path);
  if (root) ensureTests(root);
  lines = runnableLines(path, model.getValue(), {
    manager: root ? managerFor(root, path) : "npm",
    suites: root ? (getState().tests[root] ?? []) : [],
  });
  const glyphs = lines.map((item) => ({ item, ...glyphOf(item) }));
  const next = `${path}\n${glyphs.map(({ item, className }) => `${item.line}:${className}`).join("\n")}`;
  if (next === signature) return;
  signature = next;
  const m = monaco;
  decorations.set(
    glyphs.map(({ item, className, hover }) => ({
      range: new m.Range(item.line, 1, item.line, 1),
      options: { glyphMarginClassName: className, glyphMarginHoverMessage: { value: hover } },
    })),
  );
}

function trigger(item: RunnableLine): void {
  const tab = runningTab(item);
  if (tab) {
    interruptTerminal(tab);
    return;
  }
  if (item.test) {
    const root = rootOf(currentPath() ?? "");
    if (root) runTests(root, item.test.suite, item.test.target, { focus: false });
    return;
  }
  runScript(item.name, item.directory, item.run);
}

/** Branche la marge sur l'éditeur, une fois : `path` dit quel fichier il montre. */
export function installGutter(m: MonacoModule, instance: Monaco.editor.IStandaloneCodeEditor, path: () => string | undefined): void {
  monaco = m;
  editor = instance;
  currentPath = path;
  instance.updateOptions({ glyphMargin: true });
  decorations = instance.createDecorationsCollection();
  instance.onDidChangeModel(() => {
    signature = "";
    refresh();
  });
  instance.onDidChangeModelContent(() => {
    clearTimeout(timer);
    timer = setTimeout(refresh, TYPING_DELAY);
  });
  instance.onMouseDown((event) => {
    if (event.target.type !== m.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
    const line = event.target.position?.lineNumber;
    const item = lines.find((candidate) => candidate.line === line);
    if (item) trigger(item);
  });
  // Un onglet qui démarre ou s'arrête, un résultat de test : les boutons suivent.
  let scheduled = false;
  subscribe(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      refresh();
    });
  });
}

const TEST_FILE = /(\.(test|spec)\.[cm]?[jt]sx?|[\\/](test_[^\\/]+|[^\\/]+_test)\.py)$/i;

/**
 * Après un enregistrement : un `package.json` peut changer de gestionnaire ou de
 * scripts, un fichier de test ses tests, que le serveur relit sur disque.
 */
export function afterSave(path: string): void {
  const root = rootOf(path);
  if (!root) return;
  if (/[\\/]package\.json$/i.test(path)) managers.delete(root);
  if (TEST_FILE.test(path)) void loadTests(root).catch(() => undefined);
}
