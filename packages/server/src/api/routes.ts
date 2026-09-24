import { stat } from "node:fs/promises";
import { join } from "node:path";

import {
  FileHistoryResolver,
  applyRestore,
  lastSessionWrites,
  planRestore,
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
  SearchIndex,
  buildChantiers,
  ticketOfBranch,
  sessionArtifacts,
  safeServerName,
  redactServer,
  restoreMasked,
  withPlanFile,
  previewFile,
  resolveInside,
  settingsFile,
  type Scope,
  type SkillDraft,
  type ActivityEntry,
  type SkillInvocation,
  type TranscriptRef,
} from "@claude-ide/core";

import { hooksStatus, installHooks, uninstallHooks } from "../notifications/hook.js";
import { GitWorktrees, realPath } from "../platform/git.js";
import { captureScreen } from "../platform/capture.js";
import { addJsonArgs, removeArgs, runClaudeMcp, type CliScope } from "../platform/claude-cli.js";
import { readMcpStatus } from "../platform/mcp.js";
import { openPath } from "../platform/open.js";
import type { NotificationWatcher } from "../notifications/watcher.js";
import type { LiveSessions } from "../sessions/live.js";
import { moveToRecycleBin } from "../platform/trash.js";
import { calibrationOf, costOfSession, costReport } from "../sessions/costs.js";
import type { ProcessLister } from "../platform/processes.js";
import type { PtyManager } from "../pty/manager.js";

export interface ApiContext {
  index: SessionIndex;
  search: SearchIndex;
  processes: ProcessLister;
  terminals: PtyManager;
  notifications: NotificationWatcher;
  live: LiveSessions;
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

/**
 * Portée d'écriture d'un skill, exigée telle quelle.
 *
 * Rabattre une valeur inconnue sur `user` ferait d'une demande visant un skill de
 * plugin une suppression du skill personnel du même nom.
 */
function skillScope(value: unknown): Scope {
  if (value !== "user" && value !== "project") throw new Error("`scope` doit valoir user ou project");
  return value;
}

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

let searchRefreshedAt = 0;
let searchRefreshing: Promise<void> | undefined;

async function refreshSearch(search: SearchIndex): Promise<void> {
  if (Date.now() - searchRefreshedAt < 10_000) return;
  searchRefreshing ??= (async () => {
    await search.refresh();
    await search.save();
    searchRefreshedAt = Date.now();
  })().finally(() => {
    searchRefreshing = undefined;
  });
  await searchRefreshing;
}

/** En deçà, une session est peut-être en cours ailleurs : on ne la retire pas. */
const RECENT_MS = 2 * 60 * 1000;

/**
 * Ce que retirer une session emporterait, et ce qui l'interdit.
 *
 * Tout est résolu par l'index à partir de l'identifiant : une session suivie par
 * un onglet, ou écrite il y a moins de deux minutes — ouverte peut-être dans un
 * autre terminal —, est refusée. Seule une session principale se retire ; ses
 * sous-agents partent avec elle.
 */
async function removalPlan(id: string, { index, live }: ApiContext) {
  await index.refresh();
  const session = index.list({ kind: "session" }).find((entry) => entry.sessionId === id);
  if (!session) throw new Error(`session ${id} introuvable`);
  const artifacts = await sessionArtifacts(session.projectDir, id);
  const transcript = artifacts.find((artifact) => artifact.role === "transcript");
  let blocked: string | undefined;
  if (!transcript) blocked = "transcript introuvable";
  else if (live.follows(transcript.path)) blocked = "la session tourne dans un onglet";
  else if (Date.now() - (await stat(transcript.path)).mtimeMs < RECENT_MS) {
    blocked = "la session a écrit il y a moins de deux minutes : elle tourne peut-être ailleurs";
  }
  return { session, artifacts, ...(blocked ? { blocked } : {}) };
}

/**
 * Plan de restauration d'un fichier touché par une session.
 *
 * Le fichier est désigné par son chemin de suivi, cherché parmi ceux de la
 * session : on ne restaure que ce que ses sauvegardes couvrent. Une session qui
 * tourne, dans un onglet ou ailleurs, est refusée, comme pour son retrait : elle
 * pourrait réécrire le fichier juste après.
 */
async function restorePlan(id: string, trackingPath: string, { live }: ApiContext) {
  const refs = (await discoverTranscripts()).filter((ref) => ref.sessionId === id);
  const main = refs.find((ref) => ref.kind === "session");
  if (!main) throw new Error(`session ${id} introuvable`);
  const { events, projection } = await TranscriptReader.fromRef(main).poll();
  const root = projection.relocatedCwd ?? projection.worktreePath ?? projection.cwd;
  const track = projection.files.find((file) => file.trackingPath === trackingPath);
  if (!root || !track) throw new Error(`${trackingPath} n'est pas un fichier de cette session`);

  // Les écritures d'un sous-agent sont sauvegardées dans la session, mais ses
  // appels d'outils sont dans son propre transcript.
  const all = [...events];
  for (const ref of refs.filter((candidate) => candidate.kind === "subagent")) {
    all.push(...(await TranscriptReader.fromRef(ref).poll()).events);
  }
  const plan = await planRestore({ sessionId: id, track, root, writes: lastSessionWrites(all, root) });
  if (!plan.blocked && live.follows(main.path)) plan.blocked = "la session tourne dans un onglet";
  else if (!plan.blocked && Date.now() - (await stat(main.path)).mtimeMs < RECENT_MS) {
    plan.blocked = "la session a écrit il y a moins de deux minutes : elle tourne peut-être ailleurs";
  }
  return plan;
}

/** Transcript d'un sous-agent, retrouvé par sa session et son identifiant. */
async function findSubagent(sessionId: string, agentId: string): Promise<TranscriptRef> {
  const ref = (await discoverTranscripts()).find(
    (candidate) => candidate.kind === "subagent" && candidate.sessionId === sessionId && candidate.agentId === agentId,
  );
  if (!ref) throw new Error(`sous-agent ${agentId} introuvable`);
  return ref;
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
    const calibration = calibrationOf(index);
    return {
      sessions: index
        .list(projectDir ? { projectDir } : {})
        .map((session) => {
          const ticket = ticketOfBranch(session.gitBranch);
          return { ...session, price: costOfSession(session, index, calibration), ...(ticket ? { ticket } : {}) };
        }),
    };
  },

  /**
   * Chantiers : pour chaque ticket, et chaque branche qui n'en porte pas, les
   * branches, worktrees, MR et sessions qui s'y rattachent, le dernier état connu
   * du ticket et ce qu'ont coûté ses sessions travaillées.
   */
  "/api/chantiers": async (_params, { index }) => {
    await index.refresh();
    await index.save();
    const calibration = calibrationOf(index);
    const sessions = index.list({ kind: "session" });
    const byId = new Map(sessions.map((session) => [session.sessionId, session]));
    return {
      chantiers: buildChantiers(sessions).map((chantier) => {
        let usd = 0;
        let partial = false;
        for (const entry of chantier.sessions) {
          if (entry.relation !== "travaillée") continue;
          const session = byId.get(entry.sessionId);
          const price = session ? costOfSession(session, index, calibration) : undefined;
          if (!price || price.kind === "unknown") partial = true;
          else {
            usd += price.usd;
            if (price.kind === "atLeast") partial = true;
          }
        }
        return { ...chantier, cost: { usd, partial } };
      }),
    };
  },

  /** Consommation de toutes les sessions : totaux, jours, projets, modèles, tarifs déduits. */
  "/api/costs": async (_params, { index }) => {
    await index.refresh();
    await index.save();
    return costReport(index);
  },

  "/api/session": async (params, { index }) => {
    const id = requireParam(params, "id");
    return { chain: index.chain(id), subagents: index.subagents(id) };
  },

  "/api/session/removal": async (params, context) => {
    const { session, artifacts, blocked } = await removalPlan(requireParam(params, "id"), context);
    return {
      title: session.title,
      artifacts: artifacts.map(({ role, size, path }) => ({ role, size, path })),
      ...(blocked ? { blocked } : {}),
    };
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

  "/api/session/restore-plan": async (params, context) => {
    const { before: _before, ...plan } = await restorePlan(requireParam(params, "id"), requireParam(params, "path"), context);
    return plan;
  },

  /**
   * Toutes les entrées porteuses d'images de la session et de ses sous-agents,
   * dans l'ordre du temps, sans leur contenu : la galerie charge chaque image à
   * part, quand elle devient visible.
   */
  "/api/session/gallery": async (params) => {
    const id = requireParam(params, "id");
    const refs = (await discoverTranscripts()).filter((ref) => ref.sessionId === id);
    const main = refs.find((ref) => ref.kind === "session");
    if (!main) throw new Error(`session ${id} introuvable`);
    const mainEntries = buildActivity((await TranscriptReader.fromRef(main).poll()).events, {
      limit: Number.MAX_SAFE_INTEGER,
    }).entries;
    // Un sous-agent se nomme par la description de l'appel qui l'a lancé.
    const labels = new Map(
      mainEntries.flatMap((entry) => (entry.kind === "tool" && entry.agentId ? [[entry.agentId, entry.summary]] : [])),
    );
    const sources: { agentId?: string; entries: ActivityEntry[] }[] = [{ entries: mainEntries }];
    for (const ref of refs) {
      if (ref.kind !== "subagent" || !ref.agentId) continue;
      const { events } = await TranscriptReader.fromRef(ref).poll();
      sources.push({ agentId: ref.agentId, entries: buildActivity(events, { limit: Number.MAX_SAFE_INTEGER }).entries });
    }
    const items = sources.flatMap(({ agentId, entries }) =>
      entries.flatMap((entry, index) =>
        (entry.kind === "tool" || entry.kind === "prompt") && entry.images
          ? [
              {
                ...(agentId ? { agentId, agentLabel: labels.get(agentId) ?? agentId } : {}),
                index,
                kind: entry.kind,
                ...(entry.at ? { at: entry.at } : {}),
                label: entry.kind === "tool" ? entry.name : undefined,
                text: entry.kind === "tool" ? entry.summary : entry.text,
                images: entry.images,
              },
            ]
          : [],
      ),
    );
    items.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
    return { items };
  },

  /** Contenu des images d'une entrée de l'activité, désignée par sa position. */
  "/api/session/images": async (params) => {
    const id = requireParam(params, "id");
    const agent = params.get("agent");
    const index = Number(requireParam(params, "index"));
    if (!Number.isInteger(index) || index < 0) throw new Error("index invalide");
    const ref = agent ? await findSubagent(id, agent) : await findSession(id);
    const { events } = await TranscriptReader.fromRef(ref).poll();
    const entry = buildActivity(events, { limit: Number.MAX_SAFE_INTEGER, images: true }).entries[index];
    return { images: entry && (entry.kind === "tool" || entry.kind === "prompt") ? (entry.imageData ?? []) : [] };
  },

  "/api/session/activity": async (params) => {
    const id = requireParam(params, "id");
    // `agent` descend dans le transcript d'un sous-agent de la session.
    const agent = params.get("agent");
    const ref = agent ? await findSubagent(id, agent) : await findSession(id);
    const { events } = await TranscriptReader.fromRef(ref).poll();
    const around = Number(params.get("around"));
    // Une entrée trouvée par la recherche s'ouvre au milieu de son voisinage,
    // quelle que soit sa place dans la session.
    if (params.has("around") && Number.isInteger(around) && around >= 0) {
      const { entries, total } = buildActivity(events, { limit: Number.MAX_SAFE_INTEGER });
      const offset = Math.max(0, Math.min(around - 40, total - 80));
      return { entries: entries.slice(offset, offset + 80), total, offset };
    }
    const limit = Number(params.get("limit") ?? 400);
    const feed = buildActivity(events, { limit: Number.isFinite(limit) ? limit : 400 });
    return { ...feed, offset: feed.total - feed.entries.length };
  },

  /**
   * Recherche plein texte dans les transcripts. L'index est rafraîchi au plus toutes
   * les dix secondes : une frappe par requête relirait sinon, à chaque lettre, la
   * session en cours d'écriture.
   */
  "/api/search": async (params, { search, index }) => {
    const query = params.get("q") ?? "";
    await refreshSearch(search);
    const result = search.search(query);
    const sessions = new Map(index.list({ kind: "session" }).map((session) => [session.sessionId, session]));
    return {
      ...result,
      hits: result.hits.map((hit) => {
        const session = sessions.get(hit.sessionId);
        return {
          ...hit,
          ...(session?.title ? { title: session.title } : {}),
          ...(session?.effectiveCwd ? { cwd: session.effectiveCwd } : {}),
        };
      }),
    };
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
    const scope = skillScope(params.get("scope"));
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

  /**
   * Scripts du projet et de ses dossiers liés. Chaque dossier lié garde son
   * gestionnaire : lancer ses scripts avec celui du projet réécrirait son arbre
   * de dépendances.
   */
  "/api/scripts": async (params) => {
    const root = requireParam(params, "root");
    const store = new ScriptStore();
    const links = await new LinkStore().read(root);
    const linked = await Promise.all(links.map((link) => store.read(link.path).catch(() => undefined)));
    return {
      ...(await store.read(root)),
      linked: linked.filter((item) => item !== undefined && item.sources.some((source) => source.scripts.length > 0)),
    };
  },

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
    const scope = skillScope(body["scope"]);
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
    const scope = skillScope(body["scope"]);
    const directory = requireField(body, "directory", isString);
    const root = isString(body["root"]) ? body["root"] : undefined;
    const removed = await new SkillStore().remove(scope, directory, root);
    if (!removed) throw new Error(`skill ${directory} introuvable`);
    return { removed: directory };
  },

  /**
   * Retire une session : à la corbeille de Windows, jamais supprimée, avec ses
   * sous-agents, ses sauvegardes de fichiers et son environnement. Les refus de
   * l'aperçu valent ici aussi, relus au moment de l'écriture.
   */
  "/api/sessions/delete": async (_params, context, body) => {
    const id = requireField(body, "id", isString);
    const { artifacts, blocked } = await removalPlan(id, context);
    if (blocked) throw new Error(blocked);
    await moveToRecycleBin(
      artifacts.map((artifact) => artifact.path),
      context.dataDir,
    );
    await context.index.refresh();
    await context.index.save();
    return { removed: id, trashed: artifacts.length };
  },

  /**
   * Ramène un fichier à son état d'avant la session. Le plan est relu au moment
   * d'écrire, et l'empreinte vue dans l'aperçu doit correspondre au fichier : rien
   * n'est écrasé qu'on n'ait vu. Le contenu remplacé est gardé dans `restores/`.
   */
  "/api/session/restore": async (_params, context, body) => {
    const id = requireField(body, "id", isString);
    const plan = await restorePlan(id, requireField(body, "path", isString), context);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return {
      action: plan.action,
      ...(await applyRestore(plan, {
        expectedHash: requireField(body, "hash", isString),
        backupDir: join(context.dataDir, "restores", id, stamp),
        trash: (paths) => moveToRecycleBin(paths, context.dataDir),
      })),
    };
  },

  /** Copie un skill d'une portée à l'autre. `root` sert aux deux côtés : c'est le projet ouvert. */
  "/api/skills/copy": async (_params, _context, body) => {
    const from = skillScope(body["scope"]);
    const to = skillScope(body["to"]);
    const directory = requireField(body, "directory", isString);
    const root = isString(body["root"]) ? body["root"] : undefined;
    const skill = await new SkillStore().copy(
      { scope: from, directory, ...(root ? { projectRoot: root } : {}) },
      { scope: to, ...(root ? { projectRoot: root } : {}) },
    );
    return { skill };
  },

  /** Importe un `.md` ou un dossier de skill désigné par son chemin — un dépôt sous Electron. */
  "/api/skills/import": async (_params, _context, body) => {
    const scope = skillScope(body["scope"]);
    const path = requireField(body, "path", isString);
    const root = isString(body["root"]) ? body["root"] : undefined;
    return { skill: await new SkillStore().importPath(path, { scope, ...(root ? { projectRoot: root } : {}) }) };
  },

  /** Crée un skill depuis le texte d'un `.md` : ce qu'un navigateur livre d'un fichier déposé. */
  "/api/skills/import-text": async (_params, _context, body) => {
    const scope = skillScope(body["scope"]);
    const name = requireField(body, "name", isString);
    const text = requireField(body, "text", isString);
    const root = isString(body["root"]) ? body["root"] : undefined;
    return { skill: await new SkillStore().importText(name, text, { scope, ...(root ? { projectRoot: root } : {}) }) };
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

  /**
   * Capture interactive d'une zone de l'écran. La requête attend la fin de la
   * sélection, jusqu'à deux minutes, et rend le chemin de l'image.
   */
  "/api/capture": async (_params, { dataDir }) => ({ path: await captureScreen(dataDir) }),

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
