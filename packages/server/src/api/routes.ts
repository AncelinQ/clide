import {
  FileHistoryResolver,
  LinkStore,
  McpStore,
  ScriptStore,
  SessionIndex,
  SettingsEditor,
  SkillStore,
  TranscriptReader,
  breadcrumb,
  buildActivity,
  discoverTranscripts,
  extractPlan,
  listDirectory,
  normalizePath,
  safeServerName,
  redactServer,
  restoreMasked,
  withPlanFile,
  previewFile,
  resolveInside,
  settingsFile,
  type Scope,
  type SkillDraft,
  type SkillInvocation,
  type TranscriptRef,
} from "@claude-ide/core";

import { hooksStatus, installHooks, uninstallHooks } from "../notifications/hook.js";
import { GitWorktrees, realPath } from "../platform/git.js";
import { addJsonArgs, removeArgs, runClaudeMcp, type CliScope } from "../platform/claude-cli.js";
import { readMcpStatus } from "../platform/mcp.js";
import { openPath } from "../platform/open.js";
import type { NotificationWatcher } from "../notifications/watcher.js";
import type { ProcessLister } from "../platform/processes.js";
import type { PtyManager } from "../pty/manager.js";

export interface ApiContext {
  index: SessionIndex;
  processes: ProcessLister;
  terminals: PtyManager;
  notifications: NotificationWatcher;
  /**
   * Fichiers que les mutations modifient. Portés par le contexte plutôt que
   * résolus dans chaque route : ce sont les seuls endroits où l'application
   * écrit hors de son propre dossier, et un test doit pouvoir les détourner
   * sans toucher à la configuration de la machine.
   */
  settingsPath: string;
  dataDir: string;
}

export type Handler = (params: URLSearchParams, context: ApiContext) => Promise<unknown>;

/** Une mutation reçoit en plus le corps de la requête, déjà analysé. */
export type Mutation = (
  params: URLSearchParams,
  context: ApiContext,
  body: Record<string, unknown>,
) => Promise<unknown>;

function requireField<T>(body: Record<string, unknown>, name: string, check: (v: unknown) => v is T): T {
  const value = body[name];
  if (!check(value)) throw new Error(`champ \`${name}\` manquant ou invalide`);
  return value;
}

const isString = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isArray = (value: unknown): value is unknown[] => Array.isArray(value);

function requireCliScope(body: Record<string, unknown>): CliScope {
  const scope = body["scope"];
  if (scope !== "local" && scope !== "user") throw new Error("`scope` doit valoir local ou user");
  return scope;
}

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
    return withPlanFile(extractPlan(events));
  },

  "/api/files": async (params) => {
    const listing = await listDirectory(requireParam(params, "root"), params.get("path") ?? "", {
      hidden: params.get("hidden") === "1",
    });
    return { ...listing, breadcrumb: breadcrumb(listing) };
  },

  "/api/files/preview": async (params) =>
    previewFile(requireParam(params, "root"), requireParam(params, "path")),

  "/api/skills": async (params) => new SkillStore().listAll(requireParam(params, "root")),

  "/api/skill": async (params) => {
    const scope: Scope = params.get("scope") === "project" ? "project" : "user";
    const directory = requireParam(params, "directory");
    const root = params.get("root") ?? undefined;
    return { raw: await new SkillStore().readRaw(scope, directory, root) };
  },

  "/api/mcp": async (params) => {
    const root = requireParam(params, "root");
    const store = new McpStore();
    const links = await new LinkStore().read(root);
    const linked = await store.listLinked(links.map((link) => link.path));
    return { servers: [...(await store.listAll(root)), ...linked.map(redactServer)] };
  },

  /**
   * Serveurs déclarés dans les autres dossiers où l'on a travaillé, à reprendre.
   * Les dossiers viennent de l'index des sessions : il les connaît tous, sans
   * qu'on ait à les avoir ouverts ici.
   */
  "/api/mcp/library": async (params, { index }) => {
    const root = requireParam(params, "root");
    await index.refresh();
    const folders = [
      ...new Set(
        index
          .list({ kind: "session" })
          .map((session) => session.effectiveCwd)
          .filter((cwd): cwd is string => Boolean(cwd)),
      ),
    ];
    const links = await new LinkStore().read(root);
    const servers = await new McpStore().library(folders, [root, ...links.map((link) => link.path)]);
    return { servers: servers.map(redactServer) };
  },

  /**
   * État des serveurs, interrogés un à un par la CLI. Route à part de `/api/mcp`
   * parce qu'elle coûte des secondes : la liste s'affiche sans l'attendre, et
   * l'état ne part qu'à la demande.
   */
  "/api/mcp/status": async (params) => ({
    status: await readMcpStatus(params.get("root") ?? undefined),
  }),

  "/api/scripts": async (params) => new ScriptStore().read(requireParam(params, "root")),

  "/api/links": async (params) => ({ links: await new LinkStore().read(requireParam(params, "root")) }),

  "/api/settings": async (_params, { settingsPath }) => new SettingsEditor().read(settingsPath),

  /**
   * Worktrees du projet, avec les sessions qui y vivent.
   *
   * Le rattachement se fait sur `effectiveCwd` : une session déplacée dans un
   * worktree l'annonce par un `relocated`, et l'indexer sur son dossier de
   * départ la rangerait sous le dépôt principal.
   */
  "/api/worktrees": async (params, { index }) => {
    const root = requireParam(params, "root");
    const worktrees = await new GitWorktrees().details(root);
    const sessions = index.list().filter((session) => session.effectiveCwd);

    // Chaque chemin est résolu une fois, puis comparé sous sa forme canonique :
    // git rend sa propre résolution, et croiser N worktrees avec M sessions
    // paierait sinon un appel système par paire.
    const resolvedWorktrees = await Promise.all(
      worktrees.map(async (worktree) => ({ worktree, key: normalizePath(await realPath(worktree.path)) })),
    );
    const resolvedSessions = await Promise.all(
      sessions.map(async (session) => ({
        session,
        key: normalizePath(await realPath(session.effectiveCwd as string)),
      })),
    );

    return {
      worktrees: resolvedWorktrees.map(({ worktree, key }) => ({
        ...worktree,
        sessions: resolvedSessions
          .filter((entry) => entry.key === key)
          .slice(0, 20)
          .map(({ session }) => ({
            sessionId: session.sessionId,
            title: session.title,
            lastActivityAt: session.lastActivityAt,
          })),
      })),
    };
  },

  "/api/processes": async (_params, { processes, terminals }) => ({
    tree: await processes.tree(terminals.ownedPids()),
  }),

  "/api/notifications": async (_params, { notifications, dataDir, settingsPath }) => ({
    status: await hooksStatus(dataDir, settingsPath),
    recent: notifications.recent(),
  }),
};

/**
 * Routes qui agissent. Séparées des lectures et réservées à POST, pour qu'aucune
 * d'elles ne puisse être déclenchée par une simple navigation.
 */
export const mutations: Record<string, Mutation> = {
  /**
   * Déclare les hooks dans `settings.json`. Action explicite : l'application
   * modifie un fichier que l'utilisateur tient à la main, cela ne se fait pas
   * au démarrage.
   */
  "/api/notifications/install": async (_params, { dataDir, settingsPath }) => ({
    status: await installHooks(dataDir, settingsPath),
  }),

  /**
   * Édition ciblée de `settings.json`. Le chemin est une suite de clés, pas une
   * chaîne : `["env","BRANCH_PREFIX"]` désigne une clé imbriquée sans ambiguïté,
   * là où `"env.BRANCH_PREFIX"` confondrait une clé contenant un point.
   */
  "/api/settings/set": async (_params, { settingsPath }, body) => {
    const path = requireField(body, "path", isArray).filter(
      (segment): segment is string | number => typeof segment === "string" || typeof segment === "number",
    );
    if (path.length === 0) throw new Error("`path` vide");
    const document = await new SettingsEditor().update(settingsPath, [{ path, value: body["value"] }]);
    return { settings: document };
  },

  /** Écrit le fichier entier, après l'avoir validé. Sert à l'édition brute. */
  "/api/settings/replace": async (_params, { settingsPath }, body) => {
    const raw = requireField(body, "raw", isString);
    // Analysé avant d'atteindre le disque : un JSON invalide ne doit pas
    // remplacer une configuration qui fonctionne.
    SettingsEditor.parse(raw, settingsPath);
    const document = await new SettingsEditor().replace(settingsPath, raw);
    return { settings: document };
  },

  "/api/skills/save": async (_params, _context, body) => {
    const scope: Scope = requireField(body, "scope", isString) === "project" ? "project" : "user";
    const draft: SkillDraft = {
      scope,
      directory: requireField(body, "directory", isString),
      body: typeof body["body"] === "string" ? body["body"] : "",
      ...(isString(body["name"]) ? { name: body["name"] } : {}),
      ...(isString(body["description"]) ? { description: body["description"] } : {}),
      ...(isString(body["invocation"]) ? { invocation: body["invocation"] as SkillInvocation } : {}),
      ...(isString(body["root"]) ? { projectRoot: body["root"] } : {}),
    };
    return { skill: await new SkillStore().save(draft) };
  },

  "/api/skills/remove": async (_params, _context, body) => {
    const scope: Scope = requireField(body, "scope", isString) === "project" ? "project" : "user";
    const directory = requireField(body, "directory", isString);
    const root = isString(body["root"]) ? body["root"] : undefined;
    const removed = await new SkillStore().remove(scope, directory, root);
    if (!removed) throw new Error(`skill ${directory} introuvable`);
    return { removed: directory };
  },

  "/api/mcp/save": async (_params, _context, body) => {
    const root = requireField(body, "root", isString);
    const name = requireField(body, "name", isString);
    const store = new McpStore();
    // Une édition revient avec des `***` là où les secrets n'ont pas été touchés :
    // on les reprend dans la configuration écrite.
    const config = restoreMasked(
      requireField(body, "config", isRecord),
      await store.rawConfig("project", root, name),
    );
    return { server: await store.saveProjectServer(root, name, config) };
  },

  /**
   * Ajoute un serveur aux portées `local` ou `user`, par la CLI.
   *
   * Ces portées vivent dans `~/.claude.json`, qui porte aussi l'historique et
   * l'état de chaque projet : on ne le réécrit pas, `claude mcp` s'en charge.
   */
  "/api/mcp/cli/add": async (_params, _context, body) => {
    const root = requireField(body, "root", isString);
    const scope = requireCliScope(body);
    const name = safeServerName(requireField(body, "name", isString));
    const config = requireField(body, "config", isRecord);
    return { output: await runClaudeMcp(addJsonArgs(scope, name, config), root) };
  },

  "/api/mcp/cli/remove": async (_params, _context, body) => {
    const root = requireField(body, "root", isString);
    const scope = requireCliScope(body);
    const name = requireField(body, "name", isString);
    return { output: await runClaudeMcp(removeArgs(scope, name), root) };
  },

  /** Recopie un serveur dans le `.mcp.json` du projet, secrets compris, sans passer par la page. */
  "/api/mcp/copy": async (_params, _context, body) => {
    const root = requireField(body, "root", isString);
    const name = requireField(body, "name", isString);
    const from = requireField(body, "from", isString);
    const scope = requireField(body, "scope", isString);
    if (scope !== "project" && scope !== "local" && scope !== "user") {
      throw new Error("`scope` doit valoir project, local ou user");
    }
    return { server: await new McpStore().copyToProject(root, { scope, root: from, name }) };
  },

  "/api/mcp/remove": async (_params, _context, body) => {
    const root = requireField(body, "root", isString);
    const name = requireField(body, "name", isString);
    const removed = await new McpStore().removeProjectServer(root, name);
    if (!removed) throw new Error(`serveur ${name} absent de .mcp.json`);
    return { removed: name };
  },

  "/api/files/open": async (_params, _context, body) => {
    // Borné au projet comme la liste des dossiers : cette route lance une
    // application, elle ne doit pas atteindre n'importe quel fichier de la machine.
    const path = resolveInside(requireField(body, "root", isString), requireField(body, "path", isString));
    return { outcome: await openPath(path, body["reveal"] === true) };
  },

  "/api/worktrees/remove": async (_params, _context, body) => {
    const root = requireField(body, "root", isString);
    const path = requireField(body, "path", isString);
    return new GitWorktrees().remove(root, path);
  },

  "/api/links/save": async (_params, _context, body) => {
    const root = requireField(body, "root", isString);
    const links = requireField(body, "links", isArray)
      .filter(isRecord)
      .filter((link) => isString(link["path"]))
      .map((link) => ({
        path: link["path"] as string,
        readOnly: link["readOnly"] === true,
        ...(isString(link["role"]) ? { role: link["role"] as string } : {}),
      }));
    const store = new LinkStore();
    await store.write(root, links);
    return { links: await store.read(root) };
  },

  "/api/notifications/uninstall": async (_params, { dataDir, settingsPath }) => ({
    status: await uninstallHooks(dataDir, settingsPath),
  }),

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
