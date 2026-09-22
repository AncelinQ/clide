import { useSyncExternalStore } from "react";

import type { ClaudeNotification, NotificationKind, SessionSummary, TerminalInfo } from "@/lib/types";

export interface Project {
  root: string;
  name: string;
  browsePath: string;
  leftMode: string;
}

export type Theme = "auto" | "light" | "dark";

export interface State {
  projects: Project[];
  activeRoot: string | null;
  /** Terminaux ouverts, par identifiant, avec le projet qui les possède. */
  terminals: Record<string, { info: TerminalInfo; owner: string }>;
  activeTerminalId: string | null;
  /** Onglets qui réclament un regard, et à quel titre. */
  attention: Record<string, NotificationKind>;
  selectedSession: SessionSummary | null;
  sessionMode: string;
  globalTab: string;
  notifications: ClaudeNotification[];
  connected: boolean;
  theme: Theme;
  showLeft: boolean;
  showRight: boolean;
}

const SAVED = "claude-ide.state";

function restored(): Pick<State, "projects" | "activeRoot" | "theme"> {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED) ?? "{}") as {
      roots?: string[];
      active?: string;
      theme?: Theme;
    };
    const projects = (saved.roots ?? []).map(toProject);
    return {
      projects,
      activeRoot: saved.active ?? projects[0]?.root ?? null,
      theme: saved.theme ?? "auto",
    };
  } catch {
    // Rien de mémorisé, ou mémoire illisible : on démarre sans projet ouvert.
    return { projects: [], activeRoot: null, theme: "auto" };
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
  sessionMode: "files",
  globalTab: "history",
  notifications: [],
  connected: false,
  showLeft: true,
  showRight: true,
  ...restored(),
};

const listeners = new Set<() => void>();

function persist(): void {
  localStorage.setItem(
    SAVED,
    JSON.stringify({
      roots: state.projects.map((project) => project.root),
      active: state.activeRoot,
      theme: state.theme,
    }),
  );
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
    ...(activate ? { activeRoot: project.root } : {}),
  }));
}

export function updateProject(root: string, patch: Partial<Project>): void {
  setState((current) => ({
    projects: current.projects.map((project) =>
      project.root === root ? { ...project, ...patch } : project,
    ),
  }));
}

export function closeProject(root: string): void {
  setState((current) => {
    const projects = current.projects.filter((project) => project.root !== root);
    return {
      projects,
      activeRoot: current.activeRoot === root ? (projects[0]?.root ?? null) : current.activeRoot,
    };
  });
}
