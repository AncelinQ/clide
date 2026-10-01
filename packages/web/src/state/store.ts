import { useSyncExternalStore } from "react";

import { syncWorkspace } from "@/lib/api";
import { restoreLook, type LookPair } from "@/lib/looks";
import { restoreImportedTheme, type ImportedTheme } from "@/lib/vscode-theme";
import type { ClaudeNotification, DiagnosticsReport, LiveSession, NotificationKind, SessionSummary, TerminalInfo, TestSuite } from "@/lib/types";
import type { TestTarget } from "@/lib/test-commands";
import { DEFAULT_LAYOUT, DEFAULT_PROJECT, SAVED_VERSION, migrate, trimRoot, type SavedState } from "@/lib/saved-state";
import type { Keymap } from "@/lib/keymap";
import { backTarget, placementOf, splitTabs, type ScriptsShelf } from "@/lib/script-shelf";
import { ownActiveTab, tabToShow } from "@/lib/workspace";
import { LEGACY_SAVED, SAVED, saveRemote } from "@/state/saved";

export interface Project {
  root: string;
  name: string;
  browsePath: string;
  leftMode: string;
  /** Mode du bloc session sous le terminal, propre au projet. */
  bottomMode: string;
  /** Dernier onglet regardé dans le projet. */
  activeTab: string | null;
  /** Fichiers ouverts dans l'éditeur, par chemin absolu, dans l'ordre des onglets. */
  openFiles: string[];
  /** Fichier montré au centre ; `null` quand c'est un terminal. */
  activeFile: string | null;
  /** Ordre des onglets du centre, terminaux et fichiers mêlés (`orderTabs`). */
  tabOrder: string[];
  /** Ce que l'onglet Scripts retient pour le projet. */
  scripts: ScriptsShelf;
}

export type Theme = "auto" | "light" | "dark";

/** Ce que l'interface sait d'un fichier ouvert ; son texte vit dans l'éditeur, hors de React. */
export interface OpenFile {
  kind: "loading" | "text" | "image" | "diff" | "unsupported";
  /** Le texte diffère du dernier enregistré. */
  dirty: boolean;
  /** Le fichier a changé sur disque alors qu'il était modifié ici : il faut choisir. */
  changedOnDisk: boolean;
  /** Image : de quoi la montrer. */
  src?: string;
  /** Diff, transcript : son titre d'onglet. */
  title?: string;
  /** Texte en lecture seule : un transcript, qui ne s'enregistre pas. */
  readOnly?: boolean;
  /** Ce qu'il faut savoir en ouvrant : un transcript montré en partie. */
  notice?: string;
  error?: string;
}

/** Disposition des onglets du panneau global : une ligne en haut, ou une colonne à droite. */
export type TabLayout = "row" | "column";

/** Langue de l'interface ; `auto` suit celle du système. */
export type Language = "auto" | "fr" | "en";

export interface TerminalFont {
  /** Famille choisie ; vide pour la pile par défaut. */
  family: string;
  size: number;
}

export const DEFAULT_TERMINAL_FONT: TerminalFont = { family: "", size: 13 };

/** Police de l'interface, hors terminal et éditeur : famille (vide pour Segoe UI) et échelle en pour cent. */
export interface InterfaceFont {
  family: string;
  scale: number;
}

export interface State {
  projects: Project[];
  activeRoot: string | null;
  /** Terminaux ouverts, par identifiant, avec le projet qui les possède. */
  terminals: Record<string, { info: TerminalInfo; owner: string }>;
  activeTerminalId: string | null;
  /** Onglets qui réclament un regard, et à quel titre. */
  attention: Record<string, NotificationKind>;
  /**
   * Session choisie dans History, par projet : un projet où l'on n'a rien choisi
   * ne montre pas celle d'un autre.
   */
  selectedSessions: Record<string, SessionSummary>;
  /** État des fichiers ouverts dans l'éditeur, par chemin : ce que les onglets affichent. */
  files: Record<string, OpenFile>;
  /** Dernier rapport d'erreurs et de TODO de chaque projet, poussé par le serveur. */
  diagnostics: Record<string, DiagnosticsReport>;
  /** Suites de tests de chaque projet, avec leurs derniers résultats. */
  tests: Record<string, TestSuite[]>;
  /** Lancements de tests en cours, par clé de script (`dossier|nom`) : ce qui tourne. */
  testRuns: Record<string, TestTarget>;
  /** Session vivante de chaque onglet Claude, par identifiant d'onglet. */
  live: Record<string, LiveSession>;
  /**
   * Le bloc session suit l'onglet actif. Choisir une session dans History l'en
   * détache jusqu'au prochain changement d'onglet.
   */
  followLive: boolean;
  globalTab: string;
  notifications: ClaudeNotification[];
  connected: boolean;
  theme: Theme;
  /** Couleurs de l'interface, par mode ; le terminal n'en dépend pas. */
  look: LookPair;
  /** Thème VS Code importé : il remplace l'habillage, le mode clair ou sombre et les couleurs de l'éditeur. */
  vscodeTheme: ImportedTheme | null;
  terminalFont: TerminalFont;
  uiFont: InterfaceFont;
  showLeft: boolean;
  showRight: boolean;
  /** Bloc session replié sous le terminal. */
  sessionCollapsed: boolean;
  /** Entrée d'activité à montrer, ouverte depuis la recherche. */
  activityFocus: { sessionId: string; index: number; agentId?: string } | null;
  /** Sous-agents où l'on est descendu depuis l'activité d'une session, du plus haut au plus profond. */
  activityAgents: { sessionId: string; path: { agentId: string; label: string }[] } | null;
  /** Un prompt enregistré attend la valeur de `{saisie}` ; la fenêtre répond par `resolve`. */
  promptInput: { label: string; resolve: (value: string | undefined) => void } | null;
  /** Terminal de script fini qui vient de refuser une frappe : le cadre le rappelle un instant. */
  refusedInput: string | null;
  /** Dialogues que les commandes ouvrent, hors des composants qui les portent. */
  paletteOpen: boolean;
  addingProject: boolean;
  preferencesOpen: boolean;
  /**
   * Raccourcis changés par l'utilisateur, par action. `null` retire le raccourci
   * par défaut ; une action absente garde le sien.
   */
  shortcuts: Record<string, string | null>;
  language: Language;
  tabLayout: TabLayout;
  /** Onglets du panneau global affichés hors du menu « ⋯ », dans l'ordre ; tous si `null`. */
  visibleTabs: string[] | null;
  /** Modes masqués de chaque bloc à modes (`session`, `project`) ; ils restent dans son menu « ⋯ ». */
  hiddenModes: Record<string, string[]>;
  /** Les coûts des sessions s'affichent dans l'historique, l'activité et l'en-tête du terminal. */
  showCosts: boolean;
  /** Dossier où s'ouvre le sélecteur de dossier quand son champ est vide. */
  projectsFolder: string;
  /** L'application de bureau cherche seule ses nouvelles versions. */
  autoUpdate: boolean;
  /** Modules coupés dans les Réglages : leurs vues n'apparaissent nulle part. */
  disabledModules: string[];
  /** Section ouverte de la fenêtre Réglages. */
  settingsSection: string;
  /** Jeu de raccourcis ajouté aux défauts : VS Code, JetBrains, ou ceux de Clide seuls. */
  keymap: Keymap;
  /** Ce que la palette montre à son ouverture : `>` commandes, `@` sessions, `#` recherche, rien pour les fichiers. */
  paletteQuery: string;
  /** L'explorateur du projet montre les fichiers cachés (`.env`, `.claude`…). */
  showHidden: boolean;
  /** Modes dont la liste montre les éléments les plus récents en haut, par identifiant de mode. */
  newestFirst: Record<string, boolean>;
  /** Largeurs des colonnes, tirées à la souris : projet et panneau global, en pixels. */
  widths: Widths;
  /** Hauteur du bas de chaque pile de vues, en pixels. */
  stacks: Record<string, number>;
}

export interface Widths {
  left: number;
  right: number;
  /** Part de la hauteur du centre laissée à l'îlot du bas, entre 0 et 1. */
  bottom: number;
  /** Largeur de la liste de l'onglet Scripts, en pixels. */
  scripts: number;
}

export const DEFAULT_WIDTHS: Widths = DEFAULT_LAYOUT.widths;


function restored(): Pick<
  State,
  | "projects" | "activeRoot" | "theme" | "look" | "vscodeTheme" | "terminalFont" | "uiFont" | "shortcuts" | "language" | "tabLayout"
  | "visibleTabs" | "hiddenModes" | "newestFirst" | "showHidden" | "widths" | "showLeft" | "showRight"
  | "sessionCollapsed" | "globalTab" | "keymap" | "stacks" | "showCosts" | "disabledModules" | "projectsFolder"
  | "autoUpdate"
> {
  let raw: unknown;
  try {
    raw = JSON.parse(localStorage.getItem(SAVED) ?? localStorage.getItem(LEGACY_SAVED) ?? "{}");
  } catch {
    // Rien de mémorisé, ou mémoire illisible : `migrate` en fait un état vide.
  }
  const saved = migrate(raw);
  return {
    projects: saved.projects.map((project) => ({ ...project, name: nameOf(project.root) })),
    activeRoot: saved.active,
    ...saved.layout,
    ...saved.prefs,
    look: restoreLook(saved.prefs.look),
    vscodeTheme: restoreImportedTheme(saved.prefs.vscodeTheme),
  };
}

function nameOf(root: string): string {
  return root.split(/[\\/]/).pop() ?? root;
}

export function toProject(root: string): Project {
  const trimmed = trimRoot(root);
  return { root: trimmed, name: nameOf(trimmed), ...DEFAULT_PROJECT };
}

let state: State = {
  terminals: {},
  activeTerminalId: null,
  attention: {},
  selectedSessions: {},
  files: {},
  diagnostics: {},
  tests: {},
  testRuns: {},
  live: {},
  followLive: true,
  notifications: [],
  connected: false,
  activityFocus: null,
  activityAgents: null,
  paletteOpen: false,
  paletteQuery: ">",
  promptInput: null,
  refusedInput: null,
  addingProject: false,
  preferencesOpen: false,
  settingsSection: "general",
  ...restored(),
};

const listeners = new Set<() => void>();

/** Mémorise l'état durable, dans le navigateur et chez le serveur. */
function persist(): void {
  const saved: SavedState = {
    version: SAVED_VERSION,
    projects: state.projects.map(({ name: _name, ...project }) => project),
    active: state.activeRoot,
    layout: {
      widths: state.widths,
      stacks: state.stacks,
      showLeft: state.showLeft,
      showRight: state.showRight,
      sessionCollapsed: state.sessionCollapsed,
      globalTab: state.globalTab,
    },
    prefs: {
      theme: state.theme,
      look: state.look,
      vscodeTheme: state.vscodeTheme,
      terminalFont: state.terminalFont,
      uiFont: state.uiFont,
      shortcuts: state.shortcuts,
      language: state.language,
      tabLayout: state.tabLayout,
      visibleTabs: state.visibleTabs,
      hiddenModes: state.hiddenModes,
      newestFirst: state.newestFirst,
      showHidden: state.showHidden,
      keymap: state.keymap,
      showCosts: state.showCosts,
      disabledModules: state.disabledModules,
      projectsFolder: state.projectsFolder,
      autoUpdate: state.autoUpdate,
    },
  };
  const text = JSON.stringify(saved);
  try {
    localStorage.setItem(SAVED, text);
  } catch {
    // Mémoire du navigateur bloquée : la copie du serveur suffit.
  }
  saveRemote(text);
}

/**
 * Remplace l'état et prévient les abonnés.
 *
 * L'état est un objet gelé remplacé en entier : React compare des références,
 * et muter celui en place ne déclencherait aucun rendu.
 */
export function setState(patch: Partial<State> | ((current: State) => Partial<State>)): void {
  const next = typeof patch === "function" ? patch(state) : patch;
  const previous = state;
  state = { ...state, ...next };
  const before = previous.projects;
  if (state.projects !== before) announceProjects();
  persist();
  for (const listener of listeners) listener();
}

let announced = "";

/** Annonce au serveur les projets ouverts, quand leur liste change. */
function announceProjects(): void {
  const roots = state.projects.map((project) => project.root);
  const key = roots.join("\n");
  if (key === announced) return;
  announced = key;
  syncWorkspace(roots);
}

// Au démarrage, les projets relus de la mémoire.
announceProjects();

export function getState(): State {
  return state;
}

/** Prévient à chaque changement d'état, hors de React : la marge de l'éditeur, le suivi des tests. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useStore<T>(select: (state: State) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => select(state),
    () => select(state),
  );
}

// ─── Sélecteurs et actions ──────────────────────────────────────────────────

export const activeProject = (current: State = state): Project | undefined =>
  current.projects.find((project) => project.root === current.activeRoot);

export function openProject(root: string, activate = true): void {
  const project = toProject(root);
  if (!project.root) return;
  setState((current) => ({
    projects: current.projects.some((existing) => existing.root === project.root)
      ? current.projects
      : [...current.projects, project],
  }));
  if (activate) activateProject(project.root);
}

/**
 * Rend un projet actif avec l'onglet qu'on y regardait, ou son plus récent.
 *
 * Changer de projet sans changer d'onglet actif laisserait le bloc session et
 * le pied de la zone décrire l'onglet de l'autre projet, jusqu'à un clic.
 */
export function activateProject(root: string): void {
  setState((current) => {
    const remembered = current.projects.find((project) => project.root === root)?.activeTab ?? null;
    return {
      activeRoot: root,
      activeTerminalId: tabToShow(current.terminals, remembered, root, (id) => inBar(current, id)),
      followLive: true,
    };
  });
}

/** Vrai si le terminal `id` vit dans la barre d'onglets, pas dans l'onglet Scripts. */
export function inBar(current: State, id: string): boolean {
  const entry = current.terminals[id];
  return entry !== undefined && placementOf(entry.info) === "bar";
}

/** Terminaux d'un projet, dans l'ordre d'ouverture, partagés entre la barre et l'onglet Scripts. */
export function tabsOf(current: State, root: string | null): { bar: TerminalInfo[]; shelf: TerminalInfo[] } {
  return splitTabs(
    Object.values(current.terminals)
      .filter((entry) => entry.owner === root)
      .map((entry) => entry.info),
  );
}

/**
 * L'onglet Scripts est montré : le terminal actif du projet actif y est placé, et
 * aucun fichier ne passe devant. C'est la seule définition ; aucun drapeau ne la
 * double.
 */
export function scriptsShown(current: State = state): boolean {
  const project = activeProject(current);
  const id = ownActiveTab(current.terminals, current.activeTerminalId, current.activeRoot);
  return project !== undefined && project.activeFile === null && id !== undefined && !inBar(current, id);
}

/**
 * Terminal dont le bloc du bas suit la session : le terminal actif s'il est dans
 * la barre ou s'il fait tourner Claude, sinon l'onglet de la barre qu'on a quitté
 * pour l'onglet Scripts.
 */
export function sessionTabOf(current: State = state): string | null {
  const id = ownActiveTab(current.terminals, current.activeTerminalId, current.activeRoot);
  if (!id) return null;
  if (inBar(current, id) || current.terminals[id]?.info.kind === "claude") return id;
  const project = activeProject(current);
  if (!project) return null;
  return backTarget(project.scripts, tabsOf(current, project.root).bar.map((info) => info.id), project.openFiles).tab;
}

/** Projets où `owner` retient `tab` comme dernier onglet regardé. */
export function rememberTab(projects: Project[], owner: string, tab: string): Project[] {
  return projects.map((project) => (project.root === owner && project.activeTab !== tab ? { ...project, activeTab: tab } : project));
}

/** Projets où plus aucun ne retient l'onglet `tab`, qui vient de se fermer. */
export function forgetTab(projects: Project[], tab: string): Project[] {
  return projects.map((project) => (project.activeTab === tab ? { ...project, activeTab: null } : project));
}

/** Mode du bloc session du projet actif. */
export const bottomModeOf = (current: State = state): string =>
  activeProject(current)?.bottomMode ?? DEFAULT_PROJECT.bottomMode;

/** Change le mode du bloc session d'un projet, l'actif par défaut. */
export function setBottomMode(mode: string, root: string | null = state.activeRoot): void {
  if (root) updateProject(root, { bottomMode: mode });
}

/** Ouvre la fenêtre Réglages, sur une section au besoin. */
export function openSettings(section?: string): void {
  setState({ preferencesOpen: true, ...(section ? { settingsSection: section } : {}) });
}

/** Session choisie dans History pour le projet actif, s'il y en a une. */
export const selectedSessionOf = (current: State = state): SessionSummary | undefined =>
  current.activeRoot ? current.selectedSessions[current.activeRoot] : undefined;

/**
 * Montre une session de History dans le bloc du projet actif, ou retire le choix.
 * Choisir détache le bloc de l'onglet ; retirer le laisse suivre.
 */
export function selectSession(session: SessionSummary | null, options: { follow?: boolean } = {}): void {
  setState((current) => {
    if (!current.activeRoot) return {};
    const selectedSessions = { ...current.selectedSessions };
    if (session) selectedSessions[current.activeRoot] = session;
    else delete selectedSessions[current.activeRoot];
    return { selectedSessions, followLive: options.follow ?? session === null };
  });
}

export function updateProject(root: string, patch: Partial<Project>): void {
  setState((current) => ({
    projects: current.projects.map((project) =>
      project.root === root ? { ...project, ...patch } : project,
    ),
  }));
}

export function closeProject(root: string): void {
  const { projects: open, selectedSessions } = getState();
  const projects = open.filter((project) => project.root !== root);
  const { [root]: _session, ...keptSessions } = selectedSessions;
  setState({ projects, selectedSessions: keptSessions });
  if (getState().activeRoot !== root) return;
  const next = projects[0]?.root;
  if (next) activateProject(next);
  else setState({ activeRoot: null, activeTerminalId: null });
}
