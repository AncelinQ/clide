import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { appDataDir, claudeHome } from "../paths.js";
import { buildActivity, type ActivityEntry } from "../session/activity.js";
import { discoverTranscripts } from "../transcript/discover.js";
import { TranscriptReader } from "../transcript/reader.js";

const SEARCH_VERSION = 1;

/** Une ligne d'activité, texte entier, telle qu'on la cherche. */
interface Searchable {
  kind: ActivityEntry["kind"];
  text: string;
  at?: string;
  name?: string;
}

interface Document {
  sessionId: string;
  size: number;
  mtimeMs: number;
  entries: Searchable[];
}

export interface SearchHit {
  sessionId: string;
  /** Position de l'entrée dans l'activité de la session, pour l'y ouvrir. */
  index: number;
  kind: ActivityEntry["kind"];
  name?: string;
  at?: string;
  /** Passage autour de la première correspondance. */
  snippet: string;
}

export interface SearchResult {
  hits: SearchHit[];
  /** Correspondances trouvées, au-delà de celles rendues. */
  total: number;
  elapsedMs: number;
}

/** Sans accents ni casse : « reponse » trouve « Réponse ». */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function snippetOf(text: string, folded: string, word: string): string {
  const at = folded.indexOf(word);
  const start = Math.max(0, at - 80);
  const end = Math.min(text.length, at + word.length + 160);
  const flat = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${flat}${end < text.length ? "…" : ""}`;
}

/**
 * Recherche plein texte dans les transcripts : prompts, réponses, commandes et
 * appels d'outils.
 *
 * Le texte à chercher tient en quelques millions de caractères pour des centaines
 * de Mo de transcripts — les résultats d'outils n'en font pas partie. Un index
 * inversé ne se justifie pas : un parcours complet en mémoire prend quelques
 * millisecondes. Ce qui coûte est l'extraction, gardée sur le disque et refaite
 * seulement pour les transcripts qui ont changé, comme l'index des sessions.
 */
export class SearchIndex {
  readonly #documents = new Map<string, Document>();
  #folded = new Map<string, string[]>();
  readonly #file: string;
  readonly #home: string;
  #loaded = false;

  constructor(options: { home?: string; indexFile?: string } = {}) {
    this.#home = options.home ?? claudeHome();
    this.#file = options.indexFile ?? join(appDataDir(), "search-index.json");
  }

  async load(): Promise<void> {
    this.#loaded = true;
    this.#documents.clear();
    this.#folded.clear();
    try {
      const parsed = JSON.parse(await readFile(this.#file, "utf8")) as {
        version?: number;
        documents?: Record<string, Document>;
      };
      if (parsed.version !== SEARCH_VERSION || !parsed.documents) return;
      for (const [path, document] of Object.entries(parsed.documents)) this.#documents.set(path, document);
    } catch {
      // Absent ou illisible : il se reconstruit.
    }
  }

  /** Relit les transcripts qui ont changé, oublie ceux qui ont disparu. */
  async refresh(): Promise<{ reindexed: number; reused: number }> {
    if (!this.#loaded) await this.load();
    const refs = (await discoverTranscripts(this.#home)).filter((ref) => ref.kind === "session");
    const seen = new Set<string>();
    let reindexed = 0;
    let reused = 0;
    for (const ref of refs) {
      seen.add(ref.path);
      const known = this.#documents.get(ref.path);
      if (known && known.size === ref.size && known.mtimeMs === ref.mtimeMs) {
        reused++;
        continue;
      }
      const { events } = await TranscriptReader.fromRef(ref).poll();
      const entries: Searchable[] = buildActivity(events, { limit: Number.MAX_SAFE_INTEGER, full: true }).entries.map(
        (entry) => ({
          kind: entry.kind,
          text: entry.kind === "tool" ? entry.summary : entry.text,
          ...(entry.at ? { at: entry.at } : {}),
          ...(entry.kind === "tool" ? { name: entry.name } : {}),
        }),
      );
      this.#documents.set(ref.path, { sessionId: ref.sessionId, size: ref.size, mtimeMs: ref.mtimeMs, entries });
      this.#folded.delete(ref.path);
      reindexed++;
    }
    for (const path of [...this.#documents.keys()]) {
      if (!seen.has(path)) {
        this.#documents.delete(path);
        this.#folded.delete(path);
      }
    }
    return { reindexed, reused };
  }

  async save(): Promise<void> {
    await mkdir(dirname(this.#file), { recursive: true });
    const temp = `${this.#file}.${process.pid}.tmp`;
    await writeFile(
      temp,
      JSON.stringify({ version: SEARCH_VERSION, documents: Object.fromEntries(this.#documents) }),
      "utf8",
    );
    await rename(temp, this.#file);
  }

  /**
   * Entrées qui portent tous les mots de la requête, les plus récentes d'abord.
   *
   * Un mot est cherché tel quel dans le texte, sans découpage : un bout de chemin
   * ou de commande — `glab mr`, `hn-12528` — se trouve comme un mot.
   */
  search(query: string, limit = 60): SearchResult {
    const started = Date.now();
    const words = fold(query).split(/\s+/).filter(Boolean);
    if (words.length === 0) return { hits: [], total: 0, elapsedMs: 0 };

    const hits: SearchHit[] = [];
    for (const [path, document] of this.#documents) {
      let folded = this.#folded.get(path);
      if (!folded) {
        folded = document.entries.map((entry) => fold(entry.text));
        this.#folded.set(path, folded);
      }
      folded.forEach((text, index) => {
        if (!words.every((word) => text.includes(word))) return;
        const entry = document.entries[index]!;
        hits.push({
          sessionId: document.sessionId,
          index,
          kind: entry.kind,
          ...(entry.name ? { name: entry.name } : {}),
          ...(entry.at ? { at: entry.at } : {}),
          snippet: snippetOf(entry.text, text, words[0]!),
        });
      });
    }
    hits.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
    return { hits: hits.slice(0, limit), total: hits.length, elapsedMs: Date.now() - started };
  }
}
