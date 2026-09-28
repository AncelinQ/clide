import { useSyncExternalStore } from "react";

import { syncWorkspace } from "@/lib/api";
import { restoreLook, type LookPair } from "@/lib/looks";
import type { ClaudeNotification, DiagnosticsReport, LiveSession, NotificationKind, SessionSummary, TerminalInfo } from "@/lib/types";
import { DEFAULT_LAYOUT, DEFAULT_PROJECT, SAVED_VERSION, migrate, trimRoot, type SavedState } from "@/lib/saved-state";
import type { Keymap } from "@/lib/keymap";
import { tabToShow } from "@/lib/workspace";
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
  /** Diff : son titre d'onglet. */
  title?: string;
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
  terminalFont: TerminalFont;
  showLeft: boolean;
  showRight: boolean;
  /** Bloc session replié sous le terminal. */
  sessionCollapsed: boolean;
  /** Aperçu du serveur de développement ouvert à côté du terminal. */
  previewOpen: boolean;
  /** Entrée d'activité à montrer, ouverte depuis la recherche. */
  activityFocus: { sessionId: string; index: number; agentId?: string } | null;
  /** Sous-agents où l'on est descendu depuis l'activité d'une session, du plus haut au plus profond. */
  activityAgents: { sessionId: string; path: { agentId: string; label: string }[] } | null;
  /** Un prompt enregistré attend la valeur de `{saisie}` ; la fenêtre répond par `resolve`. */
  promptInput: { label: string; resolve: (value: string | undefined) => void } | null;
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
  /** Part de la zone du terminal laissée à l'aperçu, entre 0 et 1. */
  preview: number;
  /** Part de la hauteur du centre laissée à l'îlot du bas, entre 0 et 1. */
  bottom: number;
}

export const DEFAULT_WIDTHS: Widths = DEFAULT_LAYOUT.widths;


function restored(): Pick<
  State,
  | "projects" | "activeRoot" | "theme" | "look" | "terminalFont" | "shortcuts" | "language" | "tabLayout"
  | "visibleTabs" | "hiddenModes" | "newestFirst" | "showHidden" | "widths" | "showLeft" | "showRight"
  | "sessionCollapsed" | "previewOpen" | "globalTab" | "keymap" | "stacks" | "showCosts" | "disabledModules"
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
  live: {},
  followLive: true,
  notifications: [],
  connected: false,
  activityFocus: null,
  activityAgents: null,
  paletteOpen: false,
  paletteQuery: ">",
  promptInput: null,
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
      previewOpen: state.previewOpen,
      globalTab: state.globalTab,
    },
    prefs: {
      theme: state.theme,
      look: state.look,
      terminalFont: state.terminalFont,
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
  const before = state.projects;
  state = { ...state, ...next };
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

function subscribe(listener: () => void): () => void {
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
      activeTerminalId: tabToShow(current.terminals, remembered, root),
      followLive: true,
    };
  });
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
