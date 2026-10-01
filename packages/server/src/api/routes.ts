import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, sep } from "node:path";

import {
  FileHistoryResolver,
  applyRestore,
  lastSessionWrites,
  planRestore,
  LinkStore,
  McpStore,
  SessionIndex,
  SettingsEditor,
  SkillStore,
  TranscriptReader,
  breadcrumb,
  buildActivity,
  commitInstructions,
  diagramInstructions,
  mrInstructions,
  unfence,
  type WriteupKind,
  extractMermaid,
  sessionDigest,
  discoverTranscripts,
  extractPlan,
  listDirectory,
  type DirectoryEntry,
  listPlans,
  markSessions,
  normalizePath,
  SearchIndex,
  buildChantiers,
  ticketOfBranch,
  sessionArtifacts,
  safeServerName,
  redactServer,
  restoreMasked,
  readPlanFile,
  withPlanFile,
  previewFile,
  listProjectFiles,
  rankFiles,
  searchFiles,
  createEntry,
  renameEntry,
  transfer,
  readEditable,
  writeEditable,
  modifiedAt,
  resolveInside,
  settingsFile,
  type Scope,
  type SkillDraft,
  type ActivityEntry,
  type SkillInvocation,
  type TranscriptRef,
} from "@clide/core";

import { hooksStatus, installHooks, pruneLegacyHooks, uninstallHooks } from "../notifications/hook.js";
import { GitWorktrees, gitFiles, ignoredPaths, realPath } from "../platform/git.js";
import { CaptureCancelled, cancelCapture, captureScreen } from "../platform/capture.js";
import { listModels } from "../platform/models.js";
import { pickPath } from "../platform/picker.js";
import { addJsonArgs, removeArgs, runClaudeMcp, runClaudePrint, type CliScope } from "../platform/claude-cli.js";
import { servesHtml } from "../platform/html-probe.js";
import { recentSubjects } from "../platform/git.js";
import {
  DirtyTreeError,
  createBranch,
  createWorktree,
  excludeClideFiles,
  gitFetch,
  gitPull,
  gitPush,
  gitStatus,
  listBranches,
  pullMany,
  pushPlan,
  remoteUrl,
  stashCount,
  stashPop,
  switchBranch,
} from "../platform/git-actions.js";
import { discoverServers, listListening } from "../platform/listening.js";
import { reviewFor } from "../platform/review.js";
import { readMcpStatus } from "../platform/mcp.js";
import { openPath } from "../platform/open.js";
import type { NotificationWatcher } from "../notifications/watcher.js";
import type { LiveSessions } from "../sessions/live.js";
import { moveToRecycleBin } from "../platform/trash.js";
import { calibrationOf, costOfSession } from "../sessions/costs.js";
import type { ProcessLister } from "../platform/processes.js";
import type { PtyManager } from "../pty/manager.js";
import type { WorkspaceRoots } from "../workspace/roots.js";
import type { ServerBus } from "../bus.js";

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
  /** Dossiers où les routes acceptent d'agir : projets ouverts, liens, worktrees. */
  workspace: WorkspaceRoots;
  /** Canal interne : ce que les routes ont fait, que les modules suivent. */
  bus: ServerBus;
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

export function requireParam(params: URLSearchParams, name: string): string {
  const value = params.get(name);
  if (!value) throw new Error(`paramètre \`${name}\` manquant`);
  return value;
}

/**
 * État de l'interface : projets ouverts, thème, largeurs des colonnes…
 *
 * Gardé par le serveur plutôt que par le seul `localStorage` : celui-ci est
 * propre à une origine, et le serveur change de port d'un lancement à l'autre —
 * la page rouvrirait chaque fois sans rien.
 */
function uiStateFile(dataDir: string): string {
  return join(dataDir, "ui-state.json");
}

/** Borne l'état reçu : il s'écrit sur le disque à chaque changement. */
const UI_STATE_MAX_BYTES = 256 * 1024;

async function fsTransfer(mode: "copy" | "move", context: ApiContext, body: Record<string, unknown>) {
  const { workspace, dataDir, bus } = context;
  const sources = await Promise.all(requireField(body, "sources", isArray).filter(isString).map((path) => workspace.resolve(path)));
  if (sources.length === 0) throw new Error("rien à copier ni à déplacer");
  const targetDir = await workspace.resolve(requireField(body, "targetDir", isString));
  const onConflict = body["onConflict"] === "keepBoth" || body["onConflict"] === "replace" ? body["onConflict"] : "ask";
  const outcomes = await transfer(mode, sources, targetDir, {
    onConflict,
    trash: (paths) => moveToRecycleBin(paths, dataDir),
  });
  bus.emit("files", outcomes.flatMap((outcome) => (mode === "move" ? [outcome.source, outcome.target] : [outcome.target])));
  return { outcomes };
}

/** Fichiers de chaque projet, pour la palette et la recherche, avec l'heure de leur relevé. */
const fileLists = new Map<string, { files: Promise<string[]>; at: number }>();
const FILE_LIST_TTL_MS = 15_000;

/**
 * Les fichiers d'un projet : ceux que git ne dit pas ignorés dans un dépôt, sinon
 * le parcours du dossier, qui saute dépendances, sorties de build et caches. Une
 * liste git vide — un projet qu'un dépôt parent ignore en entier — vaut hors dépôt.
 */
function projectFiles(root: string): Promise<string[]> {
  const cached = fileLists.get(root);
  if (cached && Date.now() - cached.at < FILE_LIST_TTL_MS) return cached.files;
  const files = gitFiles(root).then((listed) => (listed && listed.length > 0 ? listed : listProjectFiles(root)));
  fileLists.set(root, { files, at: Date.now() });
  return files;
}

let searchRefreshedAt = 0;
let searchRefreshing: Promise<void> | undefined;

export async function refreshSearch(search: SearchIndex): Promise<void> {
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
/** Taille d'un transcript montré en entier dans l'éditeur, en caractères. */
const TRANSCRIPT_LIMIT = 20_000_000;

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

type Projection = Awaited<ReturnType<TranscriptReader["poll"]>>["projection"];

/**
 * Un fichier touché par la session, désigné par son chemin de suivi, et le
 * dossier qui le situe : la session peut avoir déménagé ou vivre dans un
 * worktree. Un chemin absent des fichiers de la session est refusé : il vient
 * de la page, et ne doit désigner que ce que la session a touché. Un fichier
 * que seule une commande a écrit n'a pas de suivi : `track` manque.
 */
function locateFile(projection: Projection, trackingPath: string) {
  const root = projection.relocatedCwd ?? projection.worktreePath ?? projection.cwd;
  const track = projection.files.find((file) => file.trackingPath === trackingPath);
  const viaBash = projection.bashEdits.some((edit) => edit.path === trackingPath);
  if (!root || (!track && !viaBash)) throw new Error(`${trackingPath} n'est pas un fichier de cette session`);
  return { root, track, absolutePath: isAbsolute(trackingPath) ? trackingPath : join(root, trackingPath) };
}

/**
 * Plan de restauration d'un fichier touché par une session.
 *
 * On ne restaure que ce que ses sauvegardes couvrent. Une session qui tourne,
 * dans un onglet ou ailleurs, est refusée, comme pour son retrait : elle
 * pourrait réécrire le fichier juste après.
 */
async function restorePlan(id: string, trackingPath: string, { live }: ApiContext) {
  const refs = (await discoverTranscripts()).filter((ref) => ref.sessionId === id);
  const main = refs.find((ref) => ref.kind === "session");
  if (!main) throw new Error(`session ${id} introuvable`);
  const { events, projection } = await TranscriptReader.fromRef(main).poll();
  const { root, track } = locateFile(projection, trackingPath);
  if (!track) throw new Error(`${trackingPath} a été écrit par une commande : aucune sauvegarde à restaurer`);

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

/** Schéma d'une session, rédigé par `claude -p` et gardé tant qu'on ne le refait pas. */
interface SessionDiagram {
  mermaid: string;
  at: string;
  costUsd?: number;
  model?: string;
  /** Le résumé envoyé a dû être coupé : le schéma ne voit pas toute la session. */
  truncated: boolean;
}

/** Modèle des rédactions — schéma, commit, MR : assez bon pour lire un diff, sans le prix d'Opus. */
const SUMMARY_MODEL = "sonnet";

/** Un identifiant de session devient un nom de fichier : il ne doit rien porter d'autre. */
function fileSafeId(id: string): string {
  if (!/^[0-9a-f-]{8,64}$/i.test(id)) throw new Error("identifiant de session invalide");
  return id;
}

function diagramFile(dataDir: string, id: string): string {
  return join(dataDir, "diagrams", `${fileSafeId(id)}.json`);
}

async function readDiagram(dataDir: string, id: string): Promise<SessionDiagram | null> {
  try {
    return JSON.parse(await readFile(diagramFile(dataDir, id), "utf8")) as SessionDiagram;
  } catch {
    return null;
  }
}

/** Rédactions en cours, une par session : un second clic attend la première. */
const drawing = new Map<string, Promise<SessionDiagram>>();

/** Résumé d'une session pour `claude -p` : ses demandes, ses fichiers et leurs diffs. */
async function digestOf(id: string) {
  const ref = await findSession(id);
  const { events, projection } = await TranscriptReader.fromRef(ref).poll();
  const root = projection.relocatedCwd ?? projection.worktreePath ?? projection.cwd;
  const diffs = root ? await new FileHistoryResolver().diffSession(id, projection.files, root) : [];
  const prompts = buildActivity(events, { limit: Number.MAX_SAFE_INTEGER, full: true }).entries.flatMap((entry) =>
    entry.kind === "prompt" ? [entry.text] : [],
  );
  if (prompts.length === 0 && diffs.length === 0) throw new Error("rien à lire : la session n'a ni demande ni fichier changé");
  return { root, digest: sessionDigest({ ...(projection.title ? { title: projection.title } : {}), prompts, diffs }) };
}

async function drawDiagram(dataDir: string, id: string, language: "fr" | "en"): Promise<SessionDiagram> {
  const { digest } = await digestOf(id);
  const answer = await runClaudePrint(digest.text, {
    instructions: diagramInstructions(language),
    model: SUMMARY_MODEL,
    cwd: dataDir,
  });
  const mermaid = extractMermaid(answer.text);
  if (!mermaid) throw new Error(`la réponse ne contient pas de diagramme : ${answer.text.slice(0, 200)}`);

  const diagram: SessionDiagram = {
    mermaid,
    at: new Date().toISOString(),
    ...(answer.costUsd !== undefined ? { costUsd: answer.costUsd } : {}),
    ...(answer.model ? { model: answer.model } : {}),
    truncated: digest.truncated,
  };
  const file = diagramFile(dataDir, id);
  await mkdir(join(dataDir, "diagrams"), { recursive: true });
  await writeFile(file, JSON.stringify(diagram, null, 2), "utf8");
  return diagram;
}

/** Message de commit ou description de MR rédigé à partir d'une session. */
interface SessionWriteup {
  text: string;
  at: string;
  costUsd?: number;
  model?: string;
  truncated: boolean;
}

function writeupFile(dataDir: string, id: string, kind: WriteupKind): string {
  return join(dataDir, "writeups", `${fileSafeId(id)}-${kind}.json`);
}

async function readWriteup(dataDir: string, id: string, kind: WriteupKind): Promise<SessionWriteup | null> {
  try {
    return JSON.parse(await readFile(writeupFile(dataDir, id, kind), "utf8")) as SessionWriteup;
  } catch {
    return null;
  }
}

const writing = new Map<string, Promise<SessionWriteup>>();

async function draftWriteup(dataDir: string, id: string, kind: WriteupKind, language: "fr" | "en"): Promise<SessionWriteup> {
  const { root, digest } = await digestOf(id);
  const instructions = kind === "commit" ? commitInstructions(root ? await recentSubjects(root) : []) : mrInstructions(language);
  const answer = await runClaudePrint(digest.text, { instructions, model: SUMMARY_MODEL, cwd: dataDir });
  const text = unfence(answer.text);
  if (!text) throw new Error("réponse vide de claude -p");
  const writeup: SessionWriteup = {
    text,
    at: new Date().toISOString(),
    ...(answer.costUsd !== undefined ? { costUsd: answer.costUsd } : {}),
    ...(answer.model ? { model: answer.model } : {}),
    truncated: digest.truncated,
  };
  await mkdir(join(dataDir, "writeups"), { recursive: true });
  await writeFile(writeupFile(dataDir, id, kind), JSON.stringify(writeup, null, 2), "utf8");
  return writeup;
}

function writeupKind(value: unknown): WriteupKind {
  if (value !== "commit" && value !== "mr") throw new Error("`kind` doit valoir commit ou mr");
  return value;
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

  "/api/session": async (params, { index }) => {
    const id = requireParam(params, "id");
    return { chain: index.chain(id), subagents: index.subagents(id) };
  },

  /**
   * Le transcript `.jsonl` d'une session, pour le lire dans l'éditeur. Lu, jamais
   * écrit ; au-delà de 20 Mo, seul le début vient, coupé à une ligne entière.
   */
  "/api/session/transcript": async (params, { index }) => {
    const id = requireParam(params, "id");
    let session = index.list({ kind: "session" }).find((entry) => entry.sessionId === id);
    if (!session) {
      await index.refresh();
      session = index.list({ kind: "session" }).find((entry) => entry.sessionId === id);
    }
    if (!session) throw new Error(`session ${id} introuvable`);
    const transcript = (await sessionArtifacts(session.projectDir, id)).find((artifact) => artifact.role === "transcript");
    if (!transcript) throw new Error("transcript introuvable");
    const text = await readFile(transcript.path, "utf8");
    if (text.length <= TRANSCRIPT_LIMIT) return { path: transcript.path, text, truncated: false };
    const cut = text.lastIndexOf("\n", TRANSCRIPT_LIMIT);
    return { path: transcript.path, text: text.slice(0, cut === -1 ? TRANSCRIPT_LIMIT : cut + 1), truncated: true };
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

    const diffs = await new FileHistoryResolver().diffSession(id, projection.files, root, projection.bashEdits);
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

  /** Schéma déjà rédigé pour la session ; `null` tant qu'on ne l'a pas demandé. */
  "/api/session/diagram": async (params, { dataDir }) => ({
    diagram: await readDiagram(dataDir, requireParam(params, "id")),
  }),

  /** Branche, amont, écart et fichiers touchés ; `null` hors d'un dépôt git. */
  "/api/git/status": async (params) => {
    const root = requireParam(params, "root");
    const status = await gitStatus(root);
    return { status, stashes: status ? await stashCount(root) : 0 };
  },

  /**
   * MR ou PR de la branche courante et l'état de sa CI, par `gh` ou `glab`.
   * Une CLI absente ou déconnectée revient en `error`, que l'interface montre.
   */
  "/api/git/review": async (params) => {
    const root = requireParam(params, "root");
    const status = await gitStatus(root);
    if (!status?.branch) return { review: null };
    const url = await remoteUrl(root).catch(() => undefined);
    if (!url) return { review: null };
    try {
      return { review: await reviewFor(root, status.branch, url) };
    } catch (error) {
      return { review: null, error: error instanceof Error ? error.message : String(error) };
    }
  },

  /** Branches locales, puis celles qui ne sont que distantes, les plus récentes d'abord. */
  "/api/git/branches": async (params) => ({ branches: await listBranches(requireParam(params, "root")) }),

  /** Ce qu'un push enverrait — commits, branche distante, amont à créer —, sans rien envoyer. */
  "/api/git/push-plan": async (params) => pushPlan(requireParam(params, "root")),

  /**
   * Pages servies par les descendants des onglets donnés, qu'ils aient été lancés
   * à la main ou par Claude en arrière-plan : leur sortie ne passe pas toujours par
   * l'onglet, mais leur port se voit. Seul ce qui répond en HTML compte.
   *
   * Les onglets sont nommés par le client, qui sait à quel projet chacun
   * appartient : un onglet ouvert dans un worktree a ce worktree pour dossier, pas
   * le projet.
   */
  "/api/preview/servers": async (params, { processes, terminals }) => {
    const own = new Set(requireParam(params, "terminals").split(","));
    const pids = new Map([...terminals.ownedPids()].filter(([, id]) => own.has(id)));
    if (pids.size === 0) return { servers: [] };
    const [sockets, list] = await Promise.all([listListening(), processes.list()]);
    const found = discoverServers(sockets, list, pids);
    const html = await Promise.all(found.map((server) => servesHtml(server.url)));
    return { servers: found.filter((_server, index) => html[index]) };
  },

  /** Message de commit ou description de MR déjà rédigé ; `null` tant qu'on ne l'a pas demandé. */
  "/api/session/writeup": async (params, { dataDir }) => ({
    writeup: await readWriteup(dataDir, requireParam(params, "id"), writeupKind(params.get("kind"))),
  }),

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
   * Une entrée de l'activité en entier, désignée par son rang dans la session :
   * le texte tel qu'écrit, ou l'appel d'outil avec son entrée et son résultat.
   */
  "/api/session/activity/entry": async (params) => {
    const id = requireParam(params, "id");
    const agent = params.get("agent");
    const index = Number(requireParam(params, "index"));
    if (!Number.isInteger(index) || index < 0) throw new Error("`index` doit être un entier positif");
    const ref = agent ? await findSubagent(id, agent) : await findSession(id);
    const { events } = await TranscriptReader.fromRef(ref).poll();
    const detail = buildActivity(events, { limit: 1, details: true }).details?.[index];
    if (!detail) throw new Error(`aucune entrée ${index} dans cette session`);
    return { detail };
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

  /** Le plan de la session ; ou, avec `path`, un autre plan de `~/.claude/plans` montré à sa place. */
  "/api/session/plan": async (params) => {
    const id = requireParam(params, "id");
    const ref = await findSession(id);
    const { events } = await TranscriptReader.fromRef(ref).poll();
    const lookup = await withPlanFile(extractPlan(events));
    const path = params.get("path");
    if (!path) return lookup;
    const plan = await readPlanFile(path);
    if (!plan) throw new Error("plan introuvable, ou hors de ~/.claude/plans");
    return { ...lookup, plan, linkedPath: path };
  },

  "/api/plans": async () => ({ plans: await listPlans() }),

  /**
   * Un dossier de l'explorateur. Ce que git ignore en disparaît, comme les fichiers
   * cachés ; avec eux (`hidden`), il revient marqué `ignored`, pour être montré en
   * retrait.
   */
  "/api/files": async (params) => {
    const root = requireParam(params, "root");
    const hidden = params.get("hidden") === "1";
    const listing = await markSessions(await listDirectory(root, params.get("path") ?? "", { hidden }));
    const key = (entry: DirectoryEntry) => `${entry.relativePath.split(sep).join("/")}${entry.directory ? "/" : ""}`;
    const ignored = await ignoredPaths(root, listing.entries.map(key));
    const entries = hidden
      ? listing.entries.map((entry) => (ignored.has(key(entry)) ? { ...entry, ignored: true } : entry))
      : listing.entries.filter((entry) => !ignored.has(key(entry)));
    const shown = { ...listing, entries };
    return { ...shown, breadcrumb: breadcrumb(shown) };
  },

  /**
   * Fichiers du projet dont le chemin répond à une recherche approximative, pour
   * la palette. La liste d'un projet est gardée quelques secondes : chaque touche
   * tapée relance la recherche, pas le parcours de l'arbre.
   */
  "/api/files/find": async (params) => {
    const root = requireParam(params, "root");
    return { files: rankFiles(await projectFiles(root), params.get("q") ?? "", 50) };
  },

  /**
   * Cherche un texte ou une expression dans les fichiers du projet, ceux que la
   * palette connaît. Une expression invalide rend son erreur, pas une exception :
   * elle arrive à chaque frappe pendant qu'on l'écrit.
   */
  "/api/files/search": async (params) => {
    const root = requireParam(params, "root");
    const query = params.get("q") ?? "";
    if (!query) return { files: [], truncated: false };
    const flag = (name: string) => params.get(name) === "1";
    try {
      return await searchFiles(root, await projectFiles(root), {
        query,
        regex: flag("regex"),
        caseSensitive: flag("case"),
        wholeWord: flag("word"),
        include: params.get("include") ?? "",
        exclude: params.get("exclude") ?? "",
      });
    } catch (error) {
      if (error instanceof SyntaxError) return { files: [], truncated: false, error: error.message };
      throw error;
    }
  },

  /** Un fichier pour l'éditeur : texte en `\n` avec sa fin de ligne d'origine, image, ou ce qui ne s'édite pas. */
  "/api/fs/read": async (params, { workspace }) => readEditable(await workspace.resolve(requireParam(params, "path"))),

  /** Horodatage d'un fichier ouvert : l'éditeur le compare au sien au retour du focus. */
  "/api/fs/stat": async (params, { workspace }) => ({
    mtimeMs: await modifiedAt(await workspace.resolve(requireParam(params, "path"))),
  }),

  /** Chemin absolu d'un fichier touché par une session, pour l'ouvrir dans l'éditeur. */
  "/api/session/files/path": async (params) => {
    const { projection } = await TranscriptReader.fromRef(await findSession(requireParam(params, "id"))).poll();
    return { path: locateFile(projection, requireParam(params, "path")).absolutePath };
  },

  "/api/files/preview": async (params) =>
    previewFile(requireParam(params, "root"), requireParam(params, "path")),

  "/api/ui-state": async (_params, { dataDir }) => {
    try {
      return { state: JSON.parse(await readFile(uiStateFile(dataDir), "utf8")) as unknown };
    } catch {
      return { state: null };
    }
  },

  /**
   * Skills et commandes du projet et de l'utilisateur ; avec un projet, aussi les
   * skills de ses dossiers liés, rangés à part : ils appartiennent à l'autre
   * dépôt, et ne masquent ni ne sont masqués par ceux du projet.
   */
  "/api/skills": async (params) => {
    const root = params.get("root") || undefined;
    const store = new SkillStore();
    const listed = await store.listAll(root);
    if (!root) return listed;
    const links = await new LinkStore().read(root).catch(() => []);
    const linked = await Promise.all(
      links.map(async (link) =>
        (await store.listProjectSkills(link.path).catch(() => [])).map((skill) => ({ ...skill, linkedFrom: link.path })),
      ),
    );
    return { ...listed, linked: linked.flat() };
  },

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

  /** Modèles qu'on peut choisir pour une session, depuis le catalogue de Claude Code. */
  "/api/models": async () => listModels(),
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
  /**
   * Fait rédiger le schéma de la session par `claude -p`. Payant : seulement à la
   * demande, jamais au passage dans le panneau.
   */
  "/api/session/diagram/draw": async (_params, { dataDir }, body) => {
    const id = requireField(body, "id", isString);
    const language = body["language"] === "en" ? "en" : "fr";
    let pending = drawing.get(id);
    if (!pending) {
      pending = drawDiagram(dataDir, id, language).finally(() => drawing.delete(id));
      drawing.set(id, pending);
    }
    return { diagram: await pending };
  },

  /** Fait rédiger par `claude -p` un message de commit ou une description de MR. Payant : à la demande. */
  "/api/session/writeup/draft": async (_params, { dataDir }, body) => {
    const id = requireField(body, "id", isString);
    const kind = writeupKind(body["kind"]);
    const language = body["language"] === "en" ? "en" : "fr";
    const key = `${id}|${kind}`;
    let pending = writing.get(key);
    if (!pending) {
      pending = draftWriteup(dataDir, id, kind, language).finally(() => writing.delete(key));
      writing.set(key, pending);
    }
    return { writeup: await pending };
  },

  /**
   * Change de branche. Des modifications en cours ne font pas échouer la requête :
   * la réponse `needsStash` dit combien de fichiers sont en jeu, pour que
   * l'interface propose de les mettre de côté.
   */
  "/api/git/switch": async (_params, _context, body) => {
    try {
      return await switchBranch(requireField(body, "root", isString), requireField(body, "branch", isString), {
        stash: body["stash"] === true,
      });
    } catch (error) {
      if (error instanceof DirtyTreeError) return { needsStash: error.changed };
      throw error;
    }
  },

  "/api/git/create-branch": async (_params, _context, body) => {
    await createBranch(requireField(body, "root", isString), requireField(body, "name", isString));
    return { ok: true };
  },

  "/api/git/stash-pop": async (_params, _context, body) => {
    await stashPop(requireField(body, "root", isString));
    return { ok: true };
  },

  /** Crée un worktree pour une branche, neuve ou existante, et rend son chemin. */
  "/api/git/worktree": async (_params, { workspace }, body) => {
    const path = await createWorktree(requireField(body, "root", isString), requireField(body, "branch", isString));
    // Le worktree s'ouvre aussitôt dans un onglet : il doit déjà être accessible.
    await workspace.refresh();
    return { path };
  },

  "/api/git/fetch": async (_params, _context, body) => {
    await gitFetch(requireField(body, "root", isString));
    return { ok: true };
  },

  "/api/git/pull": async (_params, _context, body) => {
    await gitPull(requireField(body, "root", isString));
    return { ok: true };
  },

  /**
   * Tire plusieurs dépôts en avance rapide et rend le sort de chacun. Avec
   * `withLinks`, les dossiers liés de chaque racine suivent la racine.
   */
  "/api/git/pull-many": async (_params, _context, body) => {
    const roots = requireField(body, "roots", isArray).filter(isString);
    if (roots.length === 0) throw new Error("aucun dossier à mettre à jour");
    const all: string[] = [];
    for (const root of roots) {
      all.push(root);
      if (body["withLinks"] === true) {
        for (const link of await new LinkStore().read(root)) all.push(link.path);
      }
    }
    return { results: await pullMany(all) };
  },

  /**
   * Pousse la branche courante. `head` est le commit montré dans l'aperçu : un
   * push ne part que si c'est encore lui, pour que ce qu'on a validé soit ce qui
   * est envoyé.
   */
  "/api/git/push": async (_params, _context, body) =>
    gitPush(
      requireField(body, "root", isString),
      requireField(body, "head", isString),
      // Un push forcé nomme le commit distant qu'il accepte d'écraser.
      isString(body["forceOver"]) ? { remoteHead: body["forceOver"] } : undefined,
    ),

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
  "/api/ui-state/save": async (_params, { dataDir }, body) => {
    const state = requireField(body, "state", isRecord);
    const text = JSON.stringify(state, null, 2);
    if (Buffer.byteLength(text) > UI_STATE_MAX_BYTES) throw new Error("état de l'interface trop volumineux");
    await mkdir(dataDir, { recursive: true });
    // Écrit à côté puis renommé : une coupure en pleine écriture ne laisse pas
    // un fichier tronqué, qui ferait rouvrir l'application sans projet.
    const file = uiStateFile(dataDir);
    await writeFile(`${file}.tmp`, text, "utf8");
    await rename(`${file}.tmp`, file);
    return { ok: true };
  },

  "/api/capture": async (_params, { dataDir }) => {
    try {
      return { path: await captureScreen(dataDir) };
    } catch (error) {
      // Annuler n'est pas échouer : la page n'a rien à signaler.
      if (error instanceof CaptureCancelled) return { cancelled: true };
      throw error;
    }
  },

  /** Interrompt la capture en cours : son outil peut rester ouvert, ou ne jamais rien rendre. */
  "/api/capture/cancel": async () => ({ cancelled: cancelCapture() }),

  /**
   * Ouvre la fenêtre de sélection de Windows sur le poste — un dossier, ou un
   * fichier quand `kind` vaut `file` — et attend le choix. `path` est absent
   * quand l'utilisateur annule.
   */
  "/api/pick": async (_params, { dataDir }, body) => {
    const extensions = isArray(body["extensions"]) ? body["extensions"].filter(isString) : [];
    const path = await pickPath(
      {
        kind: body["kind"] === "file" ? "file" : "folder",
        ...(isString(body["title"]) ? { title: body["title"] } : {}),
        ...(isString(body["start"]) ? { start: body["start"] } : {}),
        ...(extensions.length ? { extensions } : {}),
      },
      dataDir,
    );
    return path ? { path } : {};
  },

  "/api/files/open": async (_params, _context, body) => {
    // Borné au projet comme la liste des dossiers : cette route lance une
    // application, elle ne doit pas atteindre n'importe quel fichier de la machine.
    const path = resolveInside(requireField(body, "root", isString), requireField(body, "path", isString));
    return { outcome: await openPath(path, body["reveal"] === true) };
  },

  /**
   * Ouvre un fichier touché par la session avec l'application par défaut, ou
   * le montre dans l'Explorateur. Cette route lance une application : elle
   * n'atteint que les fichiers de la session, comme l'ouverture depuis
   * l'explorateur ne sort pas du projet.
   */
  "/api/session/files/open": async (_params, _context, body) => {
    const id = requireField(body, "id", isString);
    const { projection } = await TranscriptReader.fromRef(await findSession(id)).poll();
    const { absolutePath } = locateFile(projection, requireField(body, "path", isString));
    return { outcome: await openPath(absolutePath, body["reveal"] === true) };
  },

  "/api/worktrees/remove": async (_params, { workspace }, body) => {
    const root = requireField(body, "root", isString);
    const path = await workspace.resolve(requireField(body, "path", isString));
    const removed = await new GitWorktrees().remove(root, path);
    await workspace.refresh();
    return removed;
  },

  /** Crée un fichier vide ou un dossier dans un dossier des projets ouverts. */
  "/api/fs/create": async (_params, { workspace, bus }, body) => {
    const parent = await workspace.resolve(requireField(body, "parent", isString));
    const kind = body["kind"] === "dir" ? "dir" : "file";
    const path = await createEntry(parent, requireField(body, "name", isString), kind);
    bus.emit("files", [path]);
    return { path };
  },

  /** Renomme sur place : le nouveau nom reste dans le même dossier. */
  "/api/fs/rename": async (_params, { workspace, bus }, body) => {
    const path = await workspace.resolve(requireField(body, "path", isString));
    const renamed = await renameEntry(path, requireField(body, "name", isString));
    bus.emit("files", [path, renamed]);
    return { path: renamed };
  },

  /**
   * Copie ou déplace des éléments vers un dossier. Sources et cible sont bornées
   * aux projets ouverts, aux dossiers liés et aux worktrees ; rien n'est écrasé :
   * `ask` rend les conflits, `replace` met d'abord la cible à la corbeille.
   */
  "/api/fs/copy": async (_params, context, body) => fsTransfer("copy", context, body),
  "/api/fs/move": async (_params, context, body) => fsTransfer("move", context, body),

  /**
   * Enregistre un fichier de l'éditeur. Refusé (409) s'il a changé sur disque
   * depuis sa lecture : l'écraser effacerait ce qu'un autre y a écrit.
   */
  "/api/fs/write": async (_params, { workspace, bus }, body) => {
    const path = await workspace.resolve(requireField(body, "path", isString));
    const text = body["text"];
    const expectedMtimeMs = body["expectedMtimeMs"];
    if (typeof text !== "string") throw new Error("champ `text` manquant ou invalide");
    if (typeof expectedMtimeMs !== "number") throw new Error("champ `expectedMtimeMs` manquant ou invalide");
    const written = {
      mtimeMs: await writeEditable(path, text, {
        expectedMtimeMs,
        eol: body["eol"] === "\r\n" ? "\r\n" : "\n",
        bom: body["bom"] === true,
      }),
    };
    bus.emit("files", [path]);
    return written;
  },

  /** Met à la corbeille de Windows, d'où l'on récupère ce qu'on regrette. */
  "/api/fs/trash": async (_params, { workspace, dataDir, bus }, body) => {
    const paths = await Promise.all(requireField(body, "paths", isArray).filter(isString).map((path) => workspace.resolve(path)));
    for (const path of paths) {
      if (workspace.open.some((root) => normalizePath(root) === normalizePath(path))) throw new Error("un projet ouvert ne se met pas à la corbeille");
    }
    await moveToRecycleBin(paths, dataDir);
    bus.emit("files", paths);
    return { trashed: paths };
  },

  /**
   * Projets ouverts dans l'interface. Le serveur en déduit les dossiers où il
   * accepte d'agir ; le client attend la réponse avant ses autres appels, pour
   * qu'un projet qu'on vient d'ouvrir ne soit pas refusé.
   */
  "/api/workspace/roots": async (_params, { workspace, bus }, body) => {
    await workspace.update(requireField(body, "projects", isArray).filter(isString));
    // Un projet déjà lié ne doit pas paraître modifié dès son ouverture.
    for (const root of workspace.open) void excludeClideFiles(root);
    bus.emit("roots", workspace.open);
    return { roots: workspace.open };
  },

  "/api/links/save": async (_params, { workspace }, body) => {
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
    await excludeClideFiles(root);
    // Un dossier lié devient accessible, un lien retiré ne l'est plus.
    await workspace.refresh();
    return { links: await store.read(root) };
  },

  "/api/notifications/uninstall": async (_params, { dataDir, settingsPath }) => ({
    status: await uninstallHooks(dataDir, settingsPath),
  }),

  /** Retire les hooks d'une installation antérieure restés dans settings.json, sans rien poser. */
  "/api/notifications/prune-legacy": async (_params, { dataDir, settingsPath }) => ({
    status: await pruneLegacyHooks(dataDir, settingsPath),
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
