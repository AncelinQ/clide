import type * as Monaco from "monaco-editor";

import { api, post } from "@/lib/api";
import { ownerOf } from "@/lib/workspace";
import type { Diagnostic, DiagnosticsReport } from "@/lib/types";
import { getState, setState, type OpenFile, type Project } from "@/state/store";

/**
 * L'éditeur de fichiers vit hors de React, comme les terminaux : une seule
 * instance Monaco, prêtée à l'hôte visible, et un modèle par fichier, qui garde
 * son historique d'annulation d'un onglet à l'autre. React ne reçoit que l'état
 * de chaque fichier (modifié, changé sur disque).
 */

type MonacoModule = typeof Monaco;

interface Document {
  model: Monaco.editor.ITextModel;
  /** Dernier texte enregistré ou lu : le fichier est modifié tant qu'il en diffère. */
  saved: string;
  mtimeMs: number;
  eol: "\n" | "\r\n";
  bom: boolean;
  view?: Monaco.editor.ICodeEditorViewState | null;
}

type Readable =
  | { kind: "text"; text: string; mtimeMs: number; eol: "\n" | "\r\n"; bom: boolean }
  | { kind: "image"; mime: string; base64: string; mtimeMs: number }
  | { kind: "binary" | "too-large"; mtimeMs: number };

let loading: Promise<MonacoModule> | undefined;
/** Ligne où poser le curseur quand le fichier se montre : une erreur, un TODO, un test. */
const pendingReveal = new Map<string, { line: number; column?: number }>();
/** Diagnostics de `tsc` et d'ESLint par fichier, posés en marqueurs sur son modèle. */
const markersByPath = new Map<string, Diagnostic[]>();
let monaco: MonacoModule | undefined;
let editor: Monaco.editor.IStandaloneCodeEditor | undefined;
/** Nœud qui porte l'éditeur ; il change d'hôte sans être recréé. */
const surface = document.createElement("div");
surface.style.width = "100%";
surface.style.height = "100%";
const documents = new Map<string, Document>();
let shown: string | undefined;
const textListeners = new Map<string, Set<(text: string) => void>>();

function load(): Promise<MonacoModule> {
  loading ??= import("@/lib/monaco").then((module) => {
    monaco = module.monaco;
    // Monaco ne voit ni le tsconfig ni les dépendances : ses erreurs de typage
    // seraient fausses. Celles du vrai tsc du projet arrivent en marqueurs.
    const defaults = { noSemanticValidation: true, noSyntaxValidation: false };
    module.monaco.typescript?.typescriptDefaults?.setDiagnosticsOptions(defaults);
    module.monaco.typescript?.javascriptDefaults?.setDiagnosticsOptions(defaults);
    return module.monaco;
  });
  return loading;
}

function isDark(): boolean {
  return document.documentElement.classList.contains("dark");
}

/** L'éditeur, créé une fois ; son thème suit celui de l'application. */
async function ensureEditor(): Promise<Monaco.editor.IStandaloneCodeEditor> {
  const m = await load();
  if (editor) return editor;
  editor = m.editor.create(surface, {
    automaticLayout: true,
    theme: isDark() ? "vs-dark" : "vs",
    minimap: { enabled: false },
    fontSize: 13,
    scrollBeyondLastLine: false,
    renderWhitespace: "selection",
    tabSize: 2,
  });
  new MutationObserver(() => m.editor.setTheme(isDark() ? "vs-dark" : "vs")).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  // Ctrl+S dans l'éditeur : l'écoute globale ne le voit pas, Monaco le garde pour lui.
  editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => {
    if (shown) void saveFile(shown);
  });
  // Quitter l'éditeur relit l'état du fichier sur disque au retour : Claude a pu l'écrire entre-temps.
  editor.onDidFocusEditorText(() => {
    if (shown) void checkOnDisk(shown);
  });
  return editor;
}

function patchFile(path: string, patch: Partial<OpenFile>): void {
  setState((current) => {
    const known = current.files[path];
    if (!known) return {};
    return { files: { ...current.files, [path]: { ...known, ...patch } } };
  });
}

function projectFor(path: string): string | undefined {
  const { projects, activeRoot } = getState();
  // Un diff porte son projet dans sa clé : `diff:<ref>:<racine>|<chemin>`.
  if (isDiff(path)) return path.slice(path.indexOf(":", 5) + 1, path.indexOf("|"));
  return ownerOf(path, projects.map((project) => project.root)) ?? activeRoot ?? undefined;
}

function updateOwner(root: string, change: (project: Project) => Partial<Project>): void {
  setState((current) => ({
    projects: current.projects.map((project) => (project.root === root ? { ...project, ...change(project) } : project)),
  }));
}

/** Le fichier est-il modifié par rapport au dernier enregistrement ? */
function isDirty(path: string): boolean {
  const doc = documents.get(path);
  return !!doc && doc.model.getValue() !== doc.saved;
}

async function read(path: string): Promise<Readable> {
  return api<Readable>("/api/fs/read", { path });
}

/**
 * Ouvre un fichier dans l'éditeur du projet qui le contient, et le montre. Un
 * binaire ou un fichier trop lourd s'ouvre avec l'application par défaut : rien
 * à en montrer ici.
 */
export async function openFile(path: string, at?: { line: number; column?: number }): Promise<void> {
  const owner = projectFor(path);
  if (!owner) return;
  if (at) pendingReveal.set(path, at);
  const { files } = getState();
  if (!files[path]) {
    setState((current) => ({ files: { ...current.files, [path]: { kind: "loading", dirty: false, changedOnDisk: false } } }));
  }
  updateOwner(owner, (project) => ({
    openFiles: project.openFiles.includes(path) ? project.openFiles : [...project.openFiles, path],
    activeFile: path,
  }));
  if (files[path] && files[path].kind !== "loading") return;
  try {
    const file = await read(path);
    if (file.kind === "text") {
      await adopt(path, file);
      patchFile(path, { kind: "text" });
    } else if (file.kind === "image") {
      patchFile(path, { kind: "image", src: `data:${file.mime};base64,${file.base64}` });
    } else {
      // Rien à éditer : on referme l'onglet et l'application par défaut prend le relais.
      forget(path, owner);
      void post("/api/files/open", { root: owner, path, reveal: false }).catch(() => undefined);
    }
  } catch (error) {
    patchFile(path, { kind: "unsupported", error: error instanceof Error ? error.message : String(error) });
  }
}

async function adopt(path: string, file: Extract<Readable, { kind: "text" }>): Promise<void> {
  const m = await load();
  await ensureEditor();
  const existing = documents.get(path);
  if (existing) {
    existing.model.setValue(file.text);
    Object.assign(existing, { saved: file.text, mtimeMs: file.mtimeMs, eol: file.eol, bom: file.bom });
    return;
  }
  const model = m.editor.createModel(file.text, undefined, m.Uri.file(path));
  documents.set(path, { model, saved: file.text, mtimeMs: file.mtimeMs, eol: file.eol, bom: file.bom });
  listen(path, model);
  setMarkers(path);
}

/** Tient à jour la marque « modifié » et l'aperçu d'un fichier à chaque frappe. */
function listen(path: string, model: Monaco.editor.ITextModel): void {
  model.onDidChangeContent(() => {
    const dirty = isDirty(path);
    if (getState().files[path]?.dirty !== dirty) patchFile(path, { dirty });
    for (const listener of textListeners.get(path) ?? []) listener(model.getValue());
  });
}

/** Prête l'éditeur à l'hôte visible et y montre le fichier. */
export async function mountEditor(host: HTMLElement, path: string): Promise<void> {
  const instance = await ensureEditor();
  if (surface.parentElement !== host) host.append(surface);
  const doc = documents.get(path);
  if (!doc) return;
  if (shown && shown !== path) {
    const previous = documents.get(shown);
    if (previous) previous.view = instance.saveViewState();
  }
  if (instance.getModel() !== doc.model) {
    instance.setModel(doc.model);
    if (doc.view) instance.restoreViewState(doc.view);
  }
  shown = path;
  instance.layout();
  const reveal = pendingReveal.get(path);
  if (reveal) {
    pendingReveal.delete(path);
    instance.setPosition({ lineNumber: reveal.line, column: reveal.column ?? 1 });
    instance.revealLineInCenter(reveal.line);
  }
  instance.focus();
  void checkOnDisk(path);
}

/** Clé de comparaison d'un chemin : casse et séparateurs de Windows ignorés. */
function pathKey(path: string): string {
  return path.replace(/\//g, "\\").toLowerCase();
}

function setMarkers(path: string): void {
  const doc = documents.get(path);
  if (!doc || !monaco) return;
  const m = monaco;
  const list = markersByPath.get(pathKey(path)) ?? [];
  m.editor.setModelMarkers(
    doc.model,
    "clide",
    list.map((item) => ({
      startLineNumber: item.line,
      startColumn: item.column,
      endLineNumber: item.line,
      endColumn: doc.model.getLineMaxColumn(Math.min(item.line, doc.model.getLineCount())),
      message: item.code ? `${item.message} (${item.code})` : item.message,
      source: item.source,
      severity: item.severity === "error" ? m.MarkerSeverity.Error : item.severity === "warning" ? m.MarkerSeverity.Warning : m.MarkerSeverity.Info,
    })),
  );
}

/** Pose les erreurs d'un rapport en marqueurs sur les fichiers ouverts de son projet. */
export function applyMarkers(report: DiagnosticsReport): void {
  for (const key of [...markersByPath.keys()]) {
    if (key.startsWith(pathKey(report.root))) markersByPath.delete(key);
  }
  for (const tool of report.tools) {
    if (tool.tool === "todo") continue;
    for (const item of tool.diagnostics) {
      const key = pathKey(item.path);
      markersByPath.set(key, [...(markersByPath.get(key) ?? []), item]);
    }
  }
  for (const path of documents.keys()) setMarkers(path);
}

/** Texte courant d'un fichier ouvert, et ses changements : l'aperçu Markdown s'en nourrit. */
export function watchText(path: string, listener: (text: string) => void): () => void {
  const set = textListeners.get(path) ?? new Set();
  set.add(listener);
  textListeners.set(path, set);
  const doc = documents.get(path);
  if (doc) listener(doc.model.getValue());
  return () => set.delete(listener);
}

/**
 * Enregistre. Refusé si le fichier a changé sur disque depuis sa lecture : on le
 * signale plutôt que d'effacer ce qu'un autre y a écrit ; `overwrite` passe outre,
 * sur choix explicite.
 */
export async function saveFile(path: string, options: { overwrite?: boolean } = {}): Promise<boolean> {
  const doc = documents.get(path);
  if (!doc) return false;
  const text = doc.model.getValue();
  try {
    const expectedMtimeMs = options.overwrite
      ? (await api<{ mtimeMs: number }>("/api/fs/stat", { path })).mtimeMs
      : doc.mtimeMs;
    const { mtimeMs } = await post<{ mtimeMs: number }>("/api/fs/write", {
      path,
      text,
      expectedMtimeMs,
      eol: doc.eol,
      bom: doc.bom,
    });
    Object.assign(doc, { saved: text, mtimeMs });
    patchFile(path, { dirty: isDirty(path), changedOnDisk: false, error: undefined });
    return true;
  } catch (error) {
    if ((error as { status?: number }).status === 409) patchFile(path, { changedOnDisk: true });
    else patchFile(path, { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

/** Relit le fichier depuis le disque, en abandonnant ce qui n'était pas enregistré. */
export async function reloadFile(path: string): Promise<void> {
  const file = await read(path);
  if (file.kind !== "text") return;
  await adopt(path, file);
  patchFile(path, { dirty: false, changedOnDisk: false, error: undefined });
}

/**
 * Compare l'horodatage du disque au sien. Un fichier non modifié ici se relit
 * sans rien demander ; un fichier modifié des deux côtés attend un choix.
 */
export async function checkOnDisk(path: string): Promise<void> {
  const doc = documents.get(path);
  if (!doc) return;
  try {
    const { mtimeMs } = await api<{ mtimeMs: number }>("/api/fs/stat", { path });
    if (Math.abs(mtimeMs - doc.mtimeMs) <= 1) return;
    if (isDirty(path)) patchFile(path, { changedOnDisk: true });
    else await reloadFile(path);
  } catch {
    // Fichier disparu : l'onglet reste, l'enregistrement le recréera.
  }
}

function forget(path: string, owner: string): void {
  forgetDiff(path);
  const doc = documents.get(path);
  if (doc) {
    if (shown === path) {
      editor?.setModel(null);
      shown = undefined;
    }
    doc.model.dispose();
    documents.delete(path);
  }
  textListeners.delete(path);
  setState((current) => {
    const files = { ...current.files };
    delete files[path];
    return {
      files,
      projects: current.projects.map((project) => {
        if (project.root !== owner) return project;
        const index = project.openFiles.indexOf(path);
        const openFiles = project.openFiles.filter((item) => item !== path);
        // Fermer l'onglet montré montre son voisin, ou rend la place aux terminaux.
        const activeFile =
          project.activeFile === path ? (openFiles[Math.min(index, openFiles.length - 1)] ?? null) : project.activeFile;
        return { ...project, openFiles, activeFile };
      }),
    };
  });
}

/** Ferme l'onglet d'un fichier. Refusé s'il est modifié, sauf `discard` : l'interface demande d'abord. */
export function closeFile(path: string, options: { discard?: boolean } = {}): boolean {
  if (isDirty(path) && !options.discard) return false;
  const owner = projectFor(path);
  if (owner) forget(path, owner);
  return true;
}

/** Montre un fichier déjà ouvert, sans le relire. */
export function showFile(path: string): void {
  const owner = projectFor(path);
  if (owner) updateOwner(owner, () => ({ activeFile: path }));
}

/** Rend la place aux terminaux du projet actif. */
export function showTerminals(): void {
  const { activeRoot } = getState();
  if (activeRoot) updateOwner(activeRoot, () => ({ activeFile: null }));
}

/**
 * Suit un renommage ou un déplacement fait dans l'explorateur : un fichier
 * ouvert, ou tout fichier ouvert sous un dossier renommé, change de chemin sans
 * perdre son texte ni son historique d'annulation.
 */
export function followRename(from: string, to: string): void {
  const moved = [...documents.keys()].filter((path) => path === from || path.startsWith(`${from}\\`) || path.startsWith(`${from}/`));
  const metaMoved = Object.keys(getState().files).filter(
    (path) => path === from || path.startsWith(`${from}\\`) || path.startsWith(`${from}/`),
  );
  if (moved.length === 0 && metaMoved.length === 0) return;
  const rename = (path: string) => to + path.slice(from.length);
  const m = monaco;
  for (const path of moved) {
    const doc = documents.get(path);
    if (!doc || !m) continue;
    const model = m.editor.createModel(doc.model.getValue(), undefined, m.Uri.file(rename(path)));
    const wasShown = shown === path;
    doc.model.dispose();
    documents.delete(path);
    documents.set(rename(path), { ...doc, model });
    const listeners = textListeners.get(path);
    textListeners.delete(path);
    if (listeners) textListeners.set(rename(path), listeners);
    listen(rename(path), model);
    if (wasShown) {
      editor?.setModel(model);
      shown = rename(path);
    }
  }
  setState((current) => {
    const files = { ...current.files };
    for (const path of metaMoved) {
      const meta = files[path];
      delete files[path];
      if (meta) files[rename(path)] = meta;
    }
    const swap = (path: string) => (metaMoved.includes(path) ? rename(path) : path);
    return {
      files,
      projects: current.projects.map((project) => ({
        ...project,
        openFiles: project.openFiles.map(swap),
        activeFile: project.activeFile ? swap(project.activeFile) : null,
      })),
    };
  });
}

/** Rouvre les fichiers des projets au démarrage, sans les montrer tant qu'on n'y va pas. */
export function restoreOpenFiles(): void {
  for (const project of getState().projects) {
    for (const path of project.openFiles) {
      // Un diff se recalcule à la demande, il ne survit pas au rechargement.
      if (isDiff(path)) {
        forget(path, project.root);
        continue;
      }
      // Déjà repris : l'effet de démarrage peut passer deux fois.
      if (getState().files[path]) continue;
      setState((current) => ({ files: { ...current.files, [path]: { kind: "loading", dirty: false, changedOnDisk: false } } }));
      void read(path)
        .then(async (file) => {
          if (file.kind === "text") {
            await adopt(path, file);
            patchFile(path, { kind: "text" });
          } else if (file.kind === "image") patchFile(path, { kind: "image", src: `data:${file.mime};base64,${file.base64}` });
          else forget(path, project.root);
        })
        .catch(() => forget(path, project.root));
    }
  }
}

// ─── Diffs ──────────────────────────────────────────────────────────────────

/** Onglet de diff : sa clé commence par `diff:`, jamais un chemin de fichier. */
export function isDiff(id: string): boolean {
  return id.startsWith("diff:");
}

interface DiffDocument {
  original: Monaco.editor.ITextModel;
  modified: Monaco.editor.ITextModel;
}

const diffs = new Map<string, DiffDocument>();
let diffEditor: Monaco.editor.IStandaloneDiffEditor | undefined;
const diffSurface = document.createElement("div");
diffSurface.style.width = "100%";
diffSurface.style.height = "100%";

/**
 * Ouvre, en lecture seule, les deux côtés d'un fichier : le dernier commit contre
 * le disque (`ref` absent), ou un commit contre son parent. Un même diff ouvert
 * deux fois reprend son onglet.
 */
export async function openDiff(root: string, request: { path: string; from?: string; ref?: string }): Promise<void> {
  const ref = request.ref ?? "worktree";
  const id = `diff:${ref}:${root}|${request.path}`;
  const name = request.path.split("/").pop() ?? request.path;
  const title = ref === "worktree" ? name : `${name} @ ${ref.slice(0, 7)}`;
  setState((current) => ({
    files: current.files[id] ? current.files : { ...current.files, [id]: { kind: "loading", dirty: false, changedOnDisk: false, title } },
  }));
  updateOwner(root, (project) => ({
    openFiles: project.openFiles.includes(id) ? project.openFiles : [...project.openFiles, id],
    activeFile: id,
  }));
  try {
    const sides = await api<{ original: string; modified: string }>("/api/git/diff", {
      root,
      path: request.path,
      ref,
      ...(request.from ? { from: request.from } : {}),
    });
    const m = await load();
    const uri = (side: string) => m.Uri.parse(`diff:/${encodeURIComponent(id)}/${side}/${name}`);
    const existing = diffs.get(id);
    if (existing) {
      existing.original.setValue(sides.original);
      existing.modified.setValue(sides.modified);
    } else {
      // Le nom du fichier en fin d'uri donne son langage à la coloration.
      diffs.set(id, {
        original: m.editor.createModel(sides.original, undefined, uri("a")),
        modified: m.editor.createModel(sides.modified, undefined, uri("b")),
      });
    }
    patchFile(id, { kind: "diff" });
  } catch (error) {
    patchFile(id, { kind: "unsupported", error: error instanceof Error ? error.message : String(error) });
  }
}

/** Prête l'éditeur de diff, créé une fois, à l'hôte visible. */
export async function mountDiff(host: HTMLElement, id: string): Promise<void> {
  const m = await load();
  diffEditor ??= m.editor.createDiffEditor(diffSurface, {
    automaticLayout: true,
    readOnly: true,
    originalEditable: false,
    renderSideBySide: true,
    minimap: { enabled: false },
    theme: isDark() ? "vs-dark" : "vs",
  });
  if (diffSurface.parentElement !== host) host.append(diffSurface);
  const doc = diffs.get(id);
  if (doc) diffEditor.setModel({ original: doc.original, modified: doc.modified });
  diffEditor.layout();
}

function forgetDiff(id: string): void {
  const doc = diffs.get(id);
  if (!doc) return;
  const model = diffEditor?.getModel();
  if (model?.original === doc.original) diffEditor?.setModel(null);
  doc.original.dispose();
  doc.modified.dispose();
  diffs.delete(id);
}

/** Fichiers modifiés et non enregistrés d'un projet, pour prévenir avant de fermer. */
export function dirtyFiles(root?: string): string[] {
  const { projects, files } = getState();
  return projects
    .filter((project) => !root || project.root === root)
    .flatMap((project) => project.openFiles)
    .filter((path) => files[path]?.dirty);
}

/** Texte sélectionné dans le fichier montré, pour la variable `{sélection}` des prompts. */
export function selectedText(): string {
  const selection = editor?.getSelection();
  const model = editor?.getModel();
  if (!selection || !model || selection.isEmpty()) return "";
  return model.getValueInRange(selection);
}
