import { open, stat } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";

import type { TranscriptEvent } from "./events.js";

export interface TailResult {
  events: TranscriptEvent[];
  /** Lignes complètes qui n'ont pas produit d'event exploitable. */
  malformed: number;
  bytesRead: number;
  /** Le fichier a rétréci : l'offset a été remis à zéro et tout a été relu. */
  reset: boolean;
}

type ParsedLine =
  | { kind: "event"; event: TranscriptEvent }
  | { kind: "blank" }
  | { kind: "malformed" };

/**
 * Parse une ligne de transcript. Une ligne vide n'est pas une anomalie ; une ligne
 * qui ne rend pas un objet porteur d'un `type` textuel en est une.
 */
export function parseLine(raw: string): ParsedLine {
  const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
  if (line.trim().length === 0) return { kind: "blank" };
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { kind: "malformed" };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { kind: "malformed" };
  }
  const event = value as Record<string, unknown>;
  if (typeof event["type"] !== "string") return { kind: "malformed" };
  return { kind: "event", event: event as TranscriptEvent };
}

/**
 * Lecture incrémentale d'un `.jsonl` append-only.
 *
 * Conserve l'offset atteint et la ligne partielle de fin de lecture, pour qu'un
 * appel suivant reprenne exactement où le précédent s'est arrêté même si
 * l'écriture a été coupée au milieu d'une ligne. Le décodage UTF-8 traverse les
 * frontières de chunk, un caractère multi-octets ne peut donc pas être scindé.
 */
export class JsonlTailer {
  #offset = 0;
  #pending = "";
  #decoder = new StringDecoder("utf8");

  constructor(
    readonly filePath: string,
    private readonly chunkSize: number = 1 << 20,
  ) {}

  get offset(): number {
    return this.#offset;
  }

  /** Vrai tant qu'une ligne incomplète attend la suite du fichier. */
  get hasPending(): boolean {
    return this.#pending.length > 0;
  }

  reset(): void {
    this.#offset = 0;
    this.#pending = "";
    this.#decoder = new StringDecoder("utf8");
  }

  /** Lit tout ce qui a été ajouté depuis le dernier appel. */
  async read(): Promise<TailResult> {
    let size: number;
    try {
      size = (await stat(this.filePath)).size;
    } catch {
      return { events: [], malformed: 0, bytesRead: 0, reset: false };
    }

    // Un fichier qui rétrécit a été tronqué ou remplacé : l'offset ne veut plus rien dire.
    let reset = false;
    if (size < this.#offset) {
      this.reset();
      reset = true;
    }
    if (size === this.#offset) {
      return { events: [], malformed: 0, bytesRead: 0, reset };
    }

    const events: TranscriptEvent[] = [];
    let malformed = 0;
    let bytesRead = 0;

    const handle = await open(this.filePath, "r");
    try {
      const buffer = Buffer.allocUnsafe(this.chunkSize);
      while (this.#offset < size) {
        const toRead = Math.min(this.chunkSize, size - this.#offset);
        const { bytesRead: n } = await handle.read(buffer, 0, toRead, this.#offset);
        if (n <= 0) break;
        this.#offset += n;
        bytesRead += n;

        this.#pending += this.#decoder.write(buffer.subarray(0, n));
        const parts = this.#pending.split("\n");
        this.#pending = parts.pop() ?? "";
        for (const part of parts) {
          const parsed = parseLine(part);
          if (parsed.kind === "event") events.push(parsed.event);
          else if (parsed.kind === "malformed") malformed += 1;
        }
      }
    } finally {
      await handle.close();
    }

    return { events, malformed, bytesRead, reset };
  }
}
