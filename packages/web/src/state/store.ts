import { useSyncExternalStore } from "react";

import { restoreLook, type LookPair } from "@/lib/looks";
import type { ClaudeNotification, LiveSession, NotificationKind, SessionSummary, TerminalInfo } from "@/lib/types";
import { LEGACY_SAVED, SAVED, saveRemote } from "@/state/saved";

export interface Project {
  root: string;
  name: string;
  browsePath: string;
  leftMode: string;
}

export type Theme = "auto" | "light" | "dark";

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
  selectedSession: SessionSummary | null;
  /** Session vivante de chaque onglet Claude, par identifiant d'onglet. */
  live: Record<string, LiveSession>;
  /**
   * Le bloc session suit l'onglet actif. Choisir une session dans History l'en
   * détache jusqu'au prochain changement d'onglet.
   */
  followLive: boolean;
  sessionMode: string;
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
  /** L'explorateur du projet montre les fichiers cachés (`.env`, `.claude`…). */
  showHidden: boolean;
  /** Modes dont la liste montre les éléments les plus récents en haut, par identifiant de mode. */
  newestFirst: Record<string, boolean>;
  /** Largeurs des colonnes, tirées à la souris : projet et panneau global, en pixels. */
  widths: Widths;
  /** Dernier onglet regardé dans chaque projet, par racine ; jamais mémorisé. */
  lastTab: Record<string, string>;
}

export interface Widths {
  left: number;
  right: number;
  /** Part de la zone du terminal laissée à l'aperçu, entre 0 et 1. */
  preview: number;
}

export const DEFAULT_WIDTHS: Widths = { left: 290, right: 340, preview: 0.5 };


function restored(): Pick<
  State,
  "projects" | "activeRoot" | "theme" | "look" | "terminalFont" | "shortcuts" | "language" | "tabLayout" | "visibleTabs" | "hiddenModes" | "newestFirst" | "showHidden" | "widths"
> {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED) ?? localStorage.getItem(LEGACY_SAVED) ?? "{}") as {
      roots?: string[];
      active?: string;
      theme?: Theme;
      look?: unknown;
      terminalFont?: Partial<TerminalFont>;
      shortcuts?: Record<string, string | null>;
      language?: Language;
      tabLayout?: TabLayout;
      visibleTabs?: string[] | null;
      hiddenModes?: Record<string, string[]>;
      newestFirst?: Record<string, boolean>;
      showHidden?: boolean;
      widths?: Partial<Widths>;
    };
    const projects = (saved.roots ?? []).map(toProject);
    return {
      projects,
      activeRoot: saved.active ?? projects[0]?.root ?? null,
      theme: saved.theme ?? "auto",
      look: restoreLook(saved.look),
      terminalFont: { ...DEFAULT_TERMINAL_FONT, ...saved.terminalFont },
      shortcuts: saved.shortcuts ?? {},
      language: saved.language ?? "auto",
      tabLayout: saved.tabLayout ?? "row",
      visibleTabs: saved.visibleTabs ?? null,
      hiddenModes: saved.hiddenModes ?? {},
      newestFirst: saved.newestFirst ?? {},
      showHidden: saved.showHidden ?? false,
      widths: { ...DEFAULT_WIDTHS, ...saved.widths },
    };
  } catch {
    // Rien de mémorisé, ou mémoire illisible : on démarre sans projet ouvert.
    return { projects: [], activeRoot: null, theme: "auto", look: restoreLook(undefined), terminalFont: DEFAULT_TERMINAL_FONT, shortcuts: {}, language: "auto", tabLayout: "row", visibleTabs: null, hiddenModes: {}, newestFirst: {}, showHidden: false, widths: DEFAULT_WIDTHS };
  }
}

export function toProject(root: string): Project {
  const trimmed = root.replace(/[\\/]+$/, "");
  return {
    root: trimmed,
    name: trimmed.split(/[\\/]/).pop() ?? trimmed,
    browsePath: "",
    leftMode: "links",
  };
}

let state: State = {
  terminals: {},
  activeTerminalId: null,
  attention: {},
  selectedSession: null,
  live: {},
  followLive: true,
  sessionMode: "files",
  globalTab: "history",
  notifications: [],
  connected: false,
  showLeft: true,
  showRight: true,
  sessionCollapsed: false,
  previewOpen: false,
  activityFocus: null,
  activityAgents: null,
  paletteOpen: false,
  addingProject: false,
  preferencesOpen: false,
  lastTab: {},
  ...restored(),
};

const listeners = new Set<() => void>();

/** Mémorise l'état durable, dans le navigateur et chez le serveur. */
function persist(): void {
  const text = JSON.stringify({
    roots: state.projects.map((project) => project.root),
    active: state.activeRoot,
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
    widths: state.widths,
  });
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
  state = { ...state, ...next };
  persist();
  for (const listener of listeners) listener();
}

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
    const own = Object.entries(current.terminals).filter(([, entry]) => entry.owner === root);
    const remembered = current.lastTab[root];
    const id = remembered && own.some(([candidate]) => candidate === remembered) ? remembered : (own.at(-1)?.[0] ?? null);
    return { activeRoot: root, activeTerminalId: id, followLive: true };
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
  const projects = getState().projects.filter((project) => project.root !== root);
  setState({ projects });
  if (getState().activeRoot !== root) return;
  const next = projects[0]?.root;
  if (next) activateProject(next);
  else setState({ activeRoot: null, activeTerminalId: null });
}
