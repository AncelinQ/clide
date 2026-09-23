import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { appDataDir, claudeHome } from "../paths.js";
import { discoverTranscripts, type TranscriptKind, type TranscriptRef } from "../transcript/discover.js";
import { TranscriptReader } from "../transcript/reader.js";
import type { CostState, PrLink } from "../transcript/events.js";
import type { TicketTrace } from "../work/tickets.js";
import type { SessionProjection, TokenCounts } from "./projection.js";

/** Version du format de l'index. Une valeur différente sur disque le fait repartir de zéro. */
const INDEX_VERSION = 3;

/** Résumé d'une session, suffisant pour peupler une liste sans relire son transcript. */
export interface IndexedSession {
  sessionId: string;
  projectDir: string;
  kind: TranscriptKind;
  path: string;
  /** Empreinte du fichier au moment de l'indexation, qui sert d'invalidation. */
  size: number;
  mtimeMs: number;
  agentId?: string;
  title?: string;
  lastPrompt?: string;
  effectiveCwd?: string;
  /** Worktree où la session a travaillé, s'il y en a un. */
  worktreePath?: string;
  gitBranch?: string;
  version?: string;
  startedAt?: string;
  lastActivityAt?: string;
  messageCount: number;
  eventCount: number;
  fileCount: number;
  cost?: CostState;
  /** Tokens par modèle, pour chiffrer une session que Claude Code n'a pas chiffrée. */
  usage?: Record<string, TokenCounts>;
  /** Tokens écrits après le dernier `cost-state`, que son montant ne couvre pas. */
  usageAfterCost?: Record<string, TokenCounts>;
  /** Tickets lus ou modifiés par Claude pendant la session. */
  tickets?: Record<string, TicketTrace>;
  continuedInSessionId?: string;
  prLinks: PrLink[];
  unknownTypes: Record<string, number>;
}

export interface RefreshReport {
  scanned: number;
  reused: number;
  reindexed: number;
  dropped: number;
  elapsedMs: number;
}

interface IndexFile {
  version: number;
  updatedAt: string;
  entries: IndexedSession[];
}

function summarize(
  ref: TranscriptRef,
  effectiveCwd: string | undefined,
  projection: SessionProjection,
): IndexedSession {
  return {
    sessionId: ref.sessionId,
    projectDir: ref.projectDir,
    kind: ref.kind,
    path: ref.path,
    size: ref.size,
    mtimeMs: ref.mtimeMs,
    ...(ref.agentId ? { agentId: ref.agentId } : {}),
    ...(projection.title ? { title: projection.title } : {}),
    ...(projection.lastPrompt ? { lastPrompt: projection.lastPrompt } : {}),
    ...(effectiveCwd ? { effectiveCwd } : {}),
    ...(projection.worktreePath ? { worktreePath: projection.worktreePath } : {}),
    ...(projection.gitBranch ? { gitBranch: projection.gitBranch } : {}),
    ...(projection.version ? { version: projection.version } : {}),
    ...(projection.startedAt ? { startedAt: projection.startedAt } : {}),
    ...(projection.lastActivityAt ? { lastActivityAt: projection.lastActivityAt } : {}),
    messageCount: projection.messageCount,
    eventCount: projection.eventCount,
    fileCount: projection.files.length,
    ...(projection.cost ? { cost: projection.cost } : {}),
    ...(projection.tokens ? { usage: projection.tokens.byModel } : {}),
    ...(projection.tokens?.afterCost ? { usageAfterCost: projection.tokens.afterCost } : {}),
    ...(Object.keys(projection.tickets).length > 0 ? { tickets: projection.tickets } : {}),
    ...(projection.continuedInSessionId
      ? { continuedInSessionId: projection.continuedInSessionId }
      : {}),
    prLinks: projection.prLinks,
    unknownTypes: projection.unknownTypes,
  };
}

/**
 * Liste des sessions, tenue à jour sans relire l'intégralité des transcripts.
 *
 * Claude Code n'écrit plus de `sessions-index.json` : reconstruire la liste
 * revient à traverser des centaines de Mo, soit une quinzaine de secondes sur un
 * poste chargé. L'index garde le résumé de chaque transcript et ne réindexe que
 * ceux dont la taille ou la date a bougé.
 *
 * Un transcript modifié est relu en entier plutôt que par sa fin : la projection
 * n'est pas sérialisable en l'état, et seule la session active change en pratique.
 */
export class SessionIndex {
  readonly #entries = new Map<string, IndexedSession>();
  readonly #file: string;
  readonly #home: string;
  #loaded = false;

  constructor(options: { home?: string; indexFile?: string } = {}) {
    this.#home = options.home ?? claudeHome();
    this.#file = options.indexFile ?? join(appDataDir(), "session-index.json");
  }

  get indexFile(): string {
    return this.#file;
  }

  get size(): number {
    return this.#entries.size;
  }

  /** Charge l'index depuis le disque. Un fichier absent, illisible ou d'une autre version repart de zéro. */
  async load(): Promise<void> {
    this.#loaded = true;
    this.#entries.clear();
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(this.#file, "utf8"));
    } catch {
      return;
    }
    const file = parsed as Partial<IndexFile>;
    if (file.version !== INDEX_VERSION || !Array.isArray(file.entries)) return;
    for (const entry of file.entries) {
      if (entry && typeof entry.path === "string") this.#entries.set(entry.path, entry);
    }
  }

  /** Confronte l'index au disque et réindexe ce qui a changé. */
  async refresh(): Promise<RefreshReport> {
    if (!this.#loaded) await this.load();
    const started = Date.now();
    const refs = await discoverTranscripts(this.#home);
    const seen = new Set<string>();
    let reused = 0;
    let reindexed = 0;

    for (const ref of refs) {
      seen.add(ref.path);
      const cached = this.#entries.get(ref.path);
      if (cached && cached.size === ref.size && cached.mtimeMs === ref.mtimeMs) {
        reused += 1;
        continue;
      }
      const reader = TranscriptReader.fromRef(ref);
      const { projection } = await reader.poll();
      this.#entries.set(ref.path, summarize(ref, reader.effectiveCwd, projection));
      reindexed += 1;
    }

    let dropped = 0;
    for (const path of [...this.#entries.keys()]) {
      if (!seen.has(path)) {
        this.#entries.delete(path);
        dropped += 1;
      }
    }

    return { scanned: refs.length, reused, reindexed, dropped, elapsedMs: Date.now() - started };
  }

  /** Écriture atomique : un plantage en cours d'écriture ne laisse pas un index tronqué. */
  async save(): Promise<void> {
    const payload: IndexFile = {
      version: INDEX_VERSION,
      updatedAt: new Date().toISOString(),
      entries: [...this.#entries.values()],
    };
    await mkdir(dirname(this.#file), { recursive: true });
    const temp = `${this.#file}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(payload)}\n`, "utf8");
    await rename(temp, this.#file);
  }

  /** Sessions principales, les plus récemment actives d'abord. */
  list(options: { kind?: TranscriptKind; projectDir?: string } = {}): IndexedSession[] {
    const kind = options.kind ?? "session";
    return [...this.#entries.values()]
      .filter((entry) => entry.kind === kind)
      .filter((entry) => !options.projectDir || entry.projectDir === options.projectDir)
      .sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? "") || b.mtimeMs - a.mtimeMs);
  }

  /** Sous-agents rattachés à une session. */
  subagents(sessionId: string): IndexedSession[] {
    return [...this.#entries.values()].filter(
      (entry) => entry.kind === "subagent" && entry.sessionId === sessionId,
    );
  }

  /**
   * Suit la chaîne des sessions reprises, de celle-ci jusqu'à la dernière.
   * Une boucle dans les données ne fait pas tourner l'appel indéfiniment.
   */
  chain(sessionId: string): IndexedSession[] {
    const bySession = new Map<string, IndexedSession>();
    for (const entry of this.#entries.values()) {
      if (entry.kind === "session") bySession.set(entry.sessionId, entry);
    }
    const out: IndexedSession[] = [];
    const visited = new Set<string>();
    let current = bySession.get(sessionId);
    while (current && !visited.has(current.sessionId)) {
      visited.add(current.sessionId);
      out.push(current);
      current = current.continuedInSessionId ? bySession.get(current.continuedInSessionId) : undefined;
    }
    return out;
  }
}
