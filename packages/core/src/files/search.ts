import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export interface FileSearchOptions {
  query: string;
  regex?: boolean;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  /** Motifs de chemins à garder, séparés par des virgules (`src/**`, `*.ts`). Vide : tout. */
  include?: string;
  /** Motifs de chemins à écarter, séparés par des virgules. */
  exclude?: string;
  /** Au-delà, la recherche s'arrête et le dit (`truncated`). */
  maxMatches?: number;
}

export interface FileSearchMatch {
  /** Ligne et colonne, comptées à partir de 1. */
  line: number;
  column: number;
  length: number;
  /** La ligne, recadrée autour du résultat quand elle est longue. */
  preview: string;
  /** Début du résultat dans `preview`. */
  previewStart: number;
}

export interface FileSearchFile {
  /** Chemin relatif à la racine, séparé par `/`. */
  path: string;
  matches: FileSearchMatch[];
}

export interface FileSearchResult {
  files: FileSearchFile[];
  /** Trop de résultats : la liste s'est arrêtée à `maxMatches`. */
  truncated: boolean;
}

const MAX_FILE_BYTES = 1_000_000;
const DEFAULT_MAX_MATCHES = 2_000;
const PREVIEW_LIMIT = 200;
const PREVIEW_BEFORE = 40;
const BATCH = 32;

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * L'expression de la recherche. Une expression invalide lève une erreur, au
 * message de l'exception de `RegExp`, que l'interface montre telle quelle.
 */
export function buildMatcher(options: FileSearchOptions): RegExp {
  const source = options.regex ? options.query : escapeRegex(options.query);
  const bounded = options.wholeWord ? `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])` : source;
  return new RegExp(bounded, `gu${options.caseSensitive ? "" : "i"}`);
}

/**
 * Un motif de chemin en expression, à la façon de VS Code : `*` dans un nom,
 * `**` à travers les dossiers, `?` pour un caractère ; un motif sans `/` vaut à
 * toute profondeur (`*.ts`), un nom de dossier vaut pour ce qu'il contient.
 */
export function globToRegExp(glob: string): RegExp {
  let pattern = glob.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (!pattern.includes("/")) pattern = `**/${pattern}`;
  let source = "";
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index] as string;
    if (char === "*" && pattern[index + 1] === "*") {
      const slash = pattern[index + 2] === "/";
      source += slash ? "(?:.*/)?" : ".*";
      index += slash ? 2 : 1;
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += escapeRegex(char);
  }
  return new RegExp(`^${source}(?:/.*)?$`, "i");
}

function globs(list: string | undefined): RegExp[] {
  return (list ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map(globToRegExp);
}

/** Les chemins que gardent les filtres. */
export function filterPaths(paths: readonly string[], include?: string, exclude?: string): string[] {
  const kept = globs(include);
  const dropped = globs(exclude);
  return paths.filter((path) => (kept.length === 0 || kept.some((glob) => glob.test(path))) && !dropped.some((glob) => glob.test(path)));
}

function preview(line: string, start: number, length: number): { preview: string; previewStart: number } {
  if (line.length <= PREVIEW_LIMIT) return { preview: line, previewStart: start };
  const from = Math.max(0, start - PREVIEW_BEFORE);
  const to = Math.min(line.length, Math.max(from + PREVIEW_LIMIT, start + length));
  return { preview: `${from > 0 ? "…" : ""}${line.slice(from, to)}${to < line.length ? "…" : ""}`, previewStart: start - from + (from > 0 ? 1 : 0) };
}

/** Les résultats d'un texte, ligne par ligne ; `limit` borne leur nombre. */
export function searchText(text: string, matcher: RegExp, limit = Infinity): FileSearchMatch[] {
  const found: FileSearchMatch[] = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length && found.length < limit; index++) {
    const line = lines[index] as string;
    matcher.lastIndex = 0;
    for (let match = matcher.exec(line); match && found.length < limit; match = matcher.exec(line)) {
      // Une expression qui peut ne rien attraper (`a*`) avancerait sur place.
      if (match[0].length === 0) {
        matcher.lastIndex++;
        continue;
      }
      found.push({ line: index + 1, column: match.index + 1, length: match[0].length, ...preview(line, match.index, match[0].length) });
    }
  }
  return found;
}

async function readText(path: string): Promise<string | undefined> {
  try {
    if ((await stat(path)).size > MAX_FILE_BYTES) return undefined;
    const text = await readFile(path, "utf8");
    // Un octet nul au début : un binaire, qu'on ne montre pas en lignes.
    return text.slice(0, 8000).includes("\u0000") ? undefined : text;
  } catch {
    return undefined;
  }
}

/**
 * Cherche dans les fichiers d'un projet (`paths`, relatifs à `root`), par lots
 * lus en parallèle. Les binaires et les fichiers de plus de 1 Mo sont sautés.
 */
export async function searchFiles(root: string, paths: readonly string[], options: FileSearchOptions): Promise<FileSearchResult> {
  const matcher = buildMatcher(options);
  const limit = options.maxMatches ?? DEFAULT_MAX_MATCHES;
  const candidates = filterPaths(paths, options.include, options.exclude);
  const files: FileSearchFile[] = [];
  let total = 0;
  for (let start = 0; start < candidates.length && total < limit; start += BATCH) {
    const batch = candidates.slice(start, start + BATCH);
    const texts = await Promise.all(batch.map((path) => readText(join(root, path))));
    batch.forEach((path, index) => {
      const text = texts[index];
      if (text === undefined || total >= limit) return;
      const matches = searchText(text, new RegExp(matcher.source, matcher.flags), limit - total);
      if (matches.length === 0) return;
      total += matches.length;
      files.push({ path, matches });
    });
  }
  return { files, truncated: total >= limit };
}
