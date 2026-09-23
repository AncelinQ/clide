import { createHash, randomBytes } from "node:crypto";
import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { structuredPatch } from "diff";

import type { FileTrack } from "../session/projection.js";
import type { TranscriptEvent } from "../transcript/events.js";
import { FileHistoryResolver } from "./history.js";

/** Outils par lesquels Claude écrit un fichier, et que ses sauvegardes couvrent. */
const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

/**
 * Délai admis entre la dernière écriture de la session et la date du fichier :
 * un formateur lancé par un hook après l'édition réécrit le fichier dans la
 * foulée, sans que ce soit une modification d'ailleurs.
 */
const SETTLE_MS = 5_000;

export type RestoreAction =
  /** Le fichier existait avant la session : il reprend son contenu d'alors. */
  | "overwrite"
  /** Il existait et a disparu depuis : il est réécrit. */
  | "recreate"
  /** La session l'a créé : il part à la corbeille. */
  | "remove";

export interface RestorePlan {
  trackingPath: string;
  absolutePath: string;
  action: RestoreAction;
  binary: boolean;
  /** Ce que la restauration change, du fichier actuel vers son état d'origine. */
  unified: string;
  /** Empreinte du fichier actuel, à rendre pour confirmer : il ne doit pas avoir bougé depuis l'aperçu. */
  currentHash: string;
  /** Dernière écriture du fichier par la session. */
  lastWrite?: string;
  /** Raison du refus ; la restauration n'est possible que sans. */
  blocked?: string;
}

function pathKey(path: string, root: string): string {
  const absolute = isAbsolute(path) ? path : resolve(root, path);
  const normalized = absolute.replace(/[\\/]+/g, "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function hashOf(content: Buffer | undefined): string {
  return content ? createHash("sha256").update(content).digest("hex") : "absent";
}

/**
 * Dernière écriture réussie de chaque fichier par la session, en millisecondes,
 * d'après l'heure où le résultat de l'outil a été consigné.
 */
export function lastSessionWrites(events: readonly TranscriptEvent[], root: string): Map<string, number> {
  const pending = new Map<string, string>();
  const writes = new Map<string, number>();
  for (const event of events) {
    const message = event["message"];
    const content = message && typeof message === "object" ? (message as Record<string, unknown>)["content"] : undefined;
    if (!Array.isArray(content)) continue;
    for (const block of content as Record<string, unknown>[]) {
      if (event.type === "assistant" && block["type"] === "tool_use" && WRITE_TOOLS.has(String(block["name"]))) {
        const input = block["input"] as Record<string, unknown> | undefined;
        const path = input?.["file_path"] ?? input?.["notebook_path"];
        if (typeof path === "string" && typeof block["id"] === "string") pending.set(block["id"], pathKey(path, root));
      } else if (event.type === "user" && block["type"] === "tool_result" && typeof block["tool_use_id"] === "string") {
        const key = pending.get(block["tool_use_id"]);
        const at = typeof event.timestamp === "string" ? Date.parse(event.timestamp) : NaN;
        if (!key || block["is_error"] === true || Number.isNaN(at)) continue;
        writes.set(key, Math.max(writes.get(key) ?? 0, at));
      }
    }
  }
  return writes;
}

function unifiedPatch(label: string, from: string, to: string): string {
  const patch = structuredPatch(label, label, from, to, "", "", { context: 3 });
  const body: string[] = [];
  for (const hunk of patch.hunks) {
    body.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
    body.push(...hunk.lines);
  }
  return body.join("\n");
}

async function readOptional(path: string): Promise<{ bytes?: Buffer; mtimeMs?: number }> {
  try {
    const [bytes, info] = await Promise.all([readFile(path), stat(path)]);
    return { bytes, mtimeMs: info.mtimeMs };
  } catch {
    return {};
  }
}

/**
 * Ce que ramener un fichier à son état d'avant la session écraserait, et ce qui
 * l'interdit : une sauvegarde absente, ou un fichier modifié après la dernière
 * écriture de la session — par quelqu'un d'autre, qu'on perdrait.
 */
export async function planRestore(input: {
  sessionId: string;
  track: FileTrack;
  root: string;
  writes: Map<string, number>;
  resolver?: FileHistoryResolver;
}): Promise<RestorePlan & { before?: Buffer }> {
  const { sessionId, track, root, writes } = input;
  const resolver = input.resolver ?? new FileHistoryResolver();
  const absolutePath = isAbsolute(track.trackingPath) ? track.trackingPath : join(root, track.trackingPath);
  const current = await readOptional(absolutePath);
  const lastWrite = writes.get(pathKey(track.trackingPath, root));

  let before: Buffer | undefined;
  let missing = false;
  if (!track.created) {
    const name = FileHistoryResolver.firstNamedBackup(track);
    before = name ? await readFile(resolver.backupPath(sessionId, name)).catch(() => undefined) : undefined;
    missing = !before;
  }

  const action: RestoreAction = track.created ? "remove" : current.bytes ? "overwrite" : "recreate";
  const binary = [current.bytes, before].some((bytes) => bytes?.subarray(0, 8000).includes(0));
  const plan: RestorePlan & { before?: Buffer } = {
    trackingPath: track.trackingPath,
    absolutePath,
    action,
    binary,
    unified:
      binary || missing
        ? ""
        : unifiedPatch(track.trackingPath.replace(/\\/g, "/"), current.bytes?.toString("utf8") ?? "", before?.toString("utf8") ?? ""),
    currentHash: hashOf(current.bytes),
    ...(lastWrite ? { lastWrite: new Date(lastWrite).toISOString() } : {}),
    ...(before ? { before } : {}),
  };

  if (missing) plan.blocked = "la sauvegarde d'origine est introuvable";
  else if (action === "remove" ? !current.bytes : before && current.bytes?.equals(before)) {
    plan.blocked = "le fichier est déjà dans son état d'avant la session";
  } else if (current.mtimeMs !== undefined && lastWrite === undefined) {
    plan.blocked = "aucune écriture de la session sur ce fichier : il a pu être modifié par un autre moyen";
  } else if (current.mtimeMs !== undefined && lastWrite !== undefined && current.mtimeMs > lastWrite + SETTLE_MS) {
    plan.blocked = "le fichier a été modifié après la dernière écriture de la session";
  }
  return plan;
}

/**
 * Ramène le fichier à son état d'origine selon un plan relu juste avant.
 *
 * Le contenu actuel est d'abord copié dans `backupDir`, pour qu'on puisse revenir
 * sur la restauration ; un fichier créé par la session part à la corbeille par
 * `trash`, qui le garde aussi. L'écriture passe par un fichier temporaire du même
 * dossier, renommé : le fichier n'est jamais à moitié écrit.
 */
export async function applyRestore(
  plan: RestorePlan & { before?: Buffer },
  options: { expectedHash: string; backupDir: string; trash: (paths: string[]) => Promise<void> },
): Promise<{ backup?: string }> {
  if (plan.blocked) throw new Error(plan.blocked);
  if (plan.currentHash !== options.expectedHash) throw new Error("le fichier a changé depuis l'aperçu : relis-le");

  if (plan.action === "remove") {
    await options.trash([plan.absolutePath]);
    return {};
  }

  let backup: string | undefined;
  if (plan.action === "overwrite") {
    await mkdir(options.backupDir, { recursive: true });
    backup = join(options.backupDir, basename(plan.absolutePath));
    await copyFile(plan.absolutePath, backup);
  }
  await mkdir(dirname(plan.absolutePath), { recursive: true });
  const temp = `${plan.absolutePath}.${randomBytes(4).toString("hex")}.restore.tmp`;
  await writeFile(temp, plan.before ?? Buffer.alloc(0));
  await rename(temp, plan.absolutePath);
  return backup ? { backup } : {};
}
