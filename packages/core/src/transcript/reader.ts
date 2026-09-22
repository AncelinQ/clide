import { SessionProjector, type SessionProjection } from "../session/projection.js";
import type { TranscriptRef } from "./discover.js";
import type { TranscriptEvent } from "./events.js";
import { JsonlTailer } from "./jsonl.js";

export interface ReadStats {
  events: number;
  malformed: number;
  bytes: number;
  resets: number;
}

export interface PollResult {
  /** Events ajoutés depuis le dernier appel. */
  events: TranscriptEvent[];
  projection: SessionProjection;
  stats: ReadStats;
}

/**
 * Lit un transcript et en maintient la projection à jour.
 *
 * Un `poll()` ne relit pas le fichier : il consomme ce qui s'est ajouté et
 * l'applique à la projection en cours. Suivre une session vivante revient donc à
 * rappeler `poll()`, sans coût proportionnel à l'historique.
 */
export class TranscriptReader {
  readonly #tailer: JsonlTailer;
  readonly #projector: SessionProjector;
  readonly #stats: ReadStats = { events: 0, malformed: 0, bytes: 0, resets: 0 };

  constructor(
    readonly filePath: string,
    sessionId: string,
  ) {
    this.#tailer = new JsonlTailer(filePath);
    this.#projector = new SessionProjector(sessionId);
  }

  static fromRef(ref: TranscriptRef): TranscriptReader {
    return new TranscriptReader(ref.path, ref.sessionId);
  }

  get stats(): ReadStats {
    return { ...this.#stats };
  }

  get effectiveCwd(): string | undefined {
    return this.#projector.effectiveCwd;
  }

  async poll(): Promise<PollResult> {
    const result = await this.#tailer.read();

    // Un reset signifie que le fichier a été tronqué : la projection accumulée
    // décrit un contenu qui n'existe plus, mais la relecture complète qui suit
    // dans le même appel la reconstruit intégralement.
    if (result.reset) this.#stats.resets += 1;

    for (const event of result.events) this.#projector.apply(event);

    this.#stats.events += result.events.length;
    this.#stats.malformed += result.malformed;
    this.#stats.bytes += result.bytesRead;

    return {
      events: result.events,
      projection: this.#projector.snapshot(),
      stats: this.stats,
    };
  }
}

/** Lecture unique et complète d'un transcript. */
export async function readTranscript(
  filePath: string,
  sessionId: string,
): Promise<{ projection: SessionProjection; stats: ReadStats }> {
  const reader = new TranscriptReader(filePath, sessionId);
  const { projection, stats } = await reader.poll();
  return { projection, stats };
}
