import { watch, type FSWatcher } from "node:fs";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import { appDataDir } from "@clide/core";

import { eventsDir, type NotificationKind } from "./hook.js";

export interface ClaudeNotification {
  id: string;
  kind: NotificationKind;
  receivedAt: string;
  sessionId?: string;
  transcriptPath?: string;
  cwd?: string;
  permissionMode?: string;
  agentType?: string;
  /** Texte à montrer : dernier message de Claude, ou libellé de la notification. */
  message?: string;
}

const KINDS = new Set<NotificationKind>(["permission", "idle", "stop", "resume", "other"]);

function pickString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function condense(text: string, max = 200): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * Lit un fichier déversé par le script de hook.
 *
 * La charge utile vient d'un contrat que la documentation ne fige pas
 * entièrement : chaque champ est optionnel, et un fichier illisible est ignoré
 * plutôt que propagé — un événement perdu vaut mieux qu'un panneau cassé.
 */
export function parseNotification(id: string, text: string): ClaudeNotification | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const envelope = value as Record<string, unknown>;

  const kind = envelope["kind"];
  const payload =
    envelope["payload"] && typeof envelope["payload"] === "object" && !Array.isArray(envelope["payload"])
      ? (envelope["payload"] as Record<string, unknown>)
      : {};

  const message = pickString(payload, ["last_assistant_message", "message", "notification", "title"]);

  return {
    id,
    kind: typeof kind === "string" && KINDS.has(kind as NotificationKind) ? (kind as NotificationKind) : "other",
    receivedAt: pickString(envelope, ["receivedAt"]) ?? new Date().toISOString(),
    ...(pickString(payload, ["session_id"]) ? { sessionId: pickString(payload, ["session_id"]) } : {}),
    ...(pickString(payload, ["transcript_path"])
      ? { transcriptPath: pickString(payload, ["transcript_path"]) }
      : {}),
    ...(pickString(payload, ["cwd"]) ? { cwd: pickString(payload, ["cwd"]) } : {}),
    ...(pickString(payload, ["permission_mode"])
      ? { permissionMode: pickString(payload, ["permission_mode"]) }
      : {}),
    ...(pickString(payload, ["agent_type"]) ? { agentType: pickString(payload, ["agent_type"]) } : {}),
    ...(message ? { message: condense(message) } : {}),
  };
}

/** Délai en deçà duquel un fichier illisible est supposé en cours d'écriture. */
const WRITE_GRACE_MS = 2000;

async function isFresh(path: string): Promise<boolean> {
  try {
    return Date.now() - (await stat(path)).mtimeMs < WRITE_GRACE_MS;
  } catch {
    return false;
  }
}

/**
 * Surveille le dossier où le script de hook déverse les événements.
 *
 * `fs.watch` sert de déclencheur rapide, doublé d'un balayage périodique :
 * sur Windows la surveillance de dossier rate des créations sous charge, et un
 * événement manqué laisserait un onglet muet jusqu'au suivant.
 *
 * Un fichier est supprimé dès qu'il est lu : le dossier est une file d'attente,
 * pas un journal — l'historique est tenu en mémoire.
 */
export class NotificationWatcher {
  readonly #directory: string;
  readonly #listeners = new Set<(notification: ClaudeNotification) => void>();
  readonly #recent: ClaudeNotification[] = [];
  #watcher: FSWatcher | undefined;
  #timer: NodeJS.Timeout | undefined;
  #chain: Promise<ClaudeNotification[]> = Promise.resolve([]);

  constructor(
    dataDir: string = appDataDir(),
    private readonly sweepMs = 3000,
    private readonly keep = 100,
  ) {
    this.#directory = eventsDir(dataDir);
  }

  get directory(): string {
    return this.#directory;
  }

  recent(): ClaudeNotification[] {
    return [...this.#recent].reverse();
  }

  on(listener: (notification: ClaudeNotification) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async start(): Promise<void> {
    await mkdir(this.#directory, { recursive: true });
    await this.drain();
    try {
      this.#watcher = watch(this.#directory, () => void this.drain());
    } catch {
      // Surveillance indisponible : le balayage périodique suffit.
    }
    this.#timer = setInterval(() => void this.drain(), this.sweepMs);
    this.#timer.unref();
  }

  stop(): void {
    this.#watcher?.close();
    this.#watcher = undefined;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
    this.#listeners.clear();
  }

  /**
   * Consomme les fichiers en attente.
   *
   * Les appels sont mis à la file plutôt que rejetés : `fs.watch` tire en
   * rafale, et une demande abandonnée parce qu'une autre est en cours laisserait
   * les derniers événements attendre le balayage suivant — or une rafale, c'est
   * précisément le cas normal (une permission puis un arrêt).
   */
  drain(): Promise<ClaudeNotification[]> {
    const next = (): Promise<ClaudeNotification[]> => this.#drainOnce();
    this.#chain = this.#chain.then(next, next);
    return this.#chain;
  }

  async #drainOnce(): Promise<ClaudeNotification[]> {
    const produced: ClaudeNotification[] = [];
    {
      let names: string[];
      try {
        names = (await readdir(this.#directory)).filter((name) => name.endsWith(".json")).sort();
      } catch {
        return [];
      }

      for (const name of names) {
        const path = join(this.#directory, name);
        let text: string;
        try {
          text = await readFile(path, "utf8");
        } catch {
          continue;
        }
        const notification = parseNotification(name.replace(/\.json$/, ""), text);
        if (!notification && (await isFresh(path))) {
          // Peut-être encore en cours d'écriture par un script d'une version
          // antérieure, qui n'écrit pas par renommage : on le relira au passage
          // suivant plutôt que de perdre l'événement.
          continue;
        }
        await rm(path, { force: true });
        if (!notification) continue;

        // Une reprise n'est pas une alerte à relire : elle ne va pas à l'historique.
        if (notification.kind !== "resume") {
          this.#recent.push(notification);
          if (this.#recent.length > this.keep) this.#recent.shift();
        }
        produced.push(notification);
        for (const listener of this.#listeners) listener(notification);
      }
    }
    return produced;
  }
}
