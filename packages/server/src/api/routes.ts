import {
  FileHistoryResolver,
  LinkStore,
  McpStore,
  ScriptStore,
  SessionIndex,
  SettingsEditor,
  SkillStore,
  TranscriptReader,
  buildActivity,
  discoverTranscripts,
  extractPlan,
  settingsFile,
  type TranscriptRef,
} from "@claude-ide/core";

import { hooksStatus, installHooks, uninstallHooks } from "../notifications/hook.js";
import type { NotificationWatcher } from "../notifications/watcher.js";
import type { ProcessLister } from "../platform/processes.js";
import type { PtyManager } from "../pty/manager.js";

export interface ApiContext {
  index: SessionIndex;
  processes: ProcessLister;
  terminals: PtyManager;
  notifications: NotificationWatcher;
}

export type Handler = (params: URLSearchParams, context: ApiContext) => Promise<unknown>;

function requireParam(params: URLSearchParams, name: string): string {
  const value = params.get(name);
  if (!value) throw new Error(`paramètre \`${name}\` manquant`);
  return value;
}

async function findSession(id: string): Promise<TranscriptRef> {
  const ref = (await discoverTranscripts()).find(
    (candidate) => candidate.sessionId === id && candidate.kind === "session",
  );
  if (!ref) throw new Error(`session ${id} introuvable`);
  return ref;
}

/**
 * Routes de lecture.
 *
 * Aucun état n'est gardé entre deux appels hormis l'index de sessions et le cache
 * de processus, tous deux là pour ne pas repayer un travail coûteux à chaque
 * ouverture de panneau.
 */
export const routes: Record<string, Handler> = {
  "/api/sessions": async (params, { index }) => {
    await index.refresh();
    await index.save();
    const projectDir = params.get("projectDir");
    return { sessions: index.list(projectDir ? { projectDir } : {}) };
  },

  "/api/session": async (params, { index }) => {
    const id = requireParam(params, "id");
    return { chain: index.chain(id), subagents: index.subagents(id) };
  },

  "/api/session/files": async (params) => {
    const id = requireParam(params, "id");
    const ref = await findSession(id);
    const { projection } = await TranscriptReader.fromRef(ref).poll();
    const root =
      params.get("root") ?? projection.relocatedCwd ?? projection.worktreePath ?? projection.cwd;
    if (!root) return { root: undefined, diffs: [] };

    const diffs = await new FileHistoryResolver().diffSession(id, projection.files, root);
    return { root, diffs };
  },

  "/api/session/activity": async (params) => {
    const id = requireParam(params, "id");
    const ref = await findSession(id);
    const { events } = await TranscriptReader.fromRef(ref).poll();
    const limit = Number(params.get("limit") ?? 400);
    return buildActivity(events, { limit: Number.isFinite(limit) ? limit : 400 });
  },

  "/api/session/plan": async (params) => {
    const id = requireParam(params, "id");
    const ref = await findSession(id);
    const { events } = await TranscriptReader.fromRef(ref).poll();
    return extractPlan(events);
  },

  "/api/skills": async (params) => new SkillStore().listAll(requireParam(params, "root")),

  "/api/mcp": async (params) => ({ servers: await new McpStore().listAll(requireParam(params, "root")) }),

  "/api/scripts": async (params) => new ScriptStore().read(requireParam(params, "root")),

  "/api/links": async (params) => ({ links: await new LinkStore().read(requireParam(params, "root")) }),

  "/api/settings": async () => new SettingsEditor().read(settingsFile()),

  "/api/processes": async (_params, { processes, terminals }) => ({
    tree: await processes.tree(terminals.ownedPids()),
  }),

  "/api/notifications": async (_params, { notifications }) => ({
    status: await hooksStatus(),
    recent: notifications.recent(),
  }),
};

/**
 * Routes qui agissent. Séparées des lectures et réservées à POST, pour qu'aucune
 * d'elles ne puisse être déclenchée par une simple navigation.
 */
export const mutations: Record<string, Handler> = {
  /**
   * Déclare les hooks dans `settings.json`. Action explicite : l'application
   * modifie un fichier que l'utilisateur tient à la main, cela ne se fait pas
   * au démarrage.
   */
  "/api/notifications/install": async () => ({ status: await installHooks() }),

  "/api/notifications/uninstall": async () => ({ status: await uninstallHooks() }),

  "/api/processes/stop": async (params, { processes, terminals }) => {
    const pid = Number(requireParam(params, "pid"));
    if (!Number.isInteger(pid)) throw new Error("`pid` doit être un entier");
    // Le magasin refuse tout identifiant absent de l'arbre Claude : une route
    // capable de tuer n'importe quoi tuerait aussi bien une session de travail.
    const stopped = await processes.stop(pid, terminals.ownedPids());
    if (!stopped) throw new Error(`le processus ${pid} n'est pas arrêtable depuis ici`);
    return { stopped: pid };
  },
};
