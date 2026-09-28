import { readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Dossiers qu'on ne parcourt jamais pour chercher un fichier par son nom : des
 * dépendances, des sorties de build, des caches. Les y chercher noierait les
 * fichiers du projet et coûterait des secondes sur un arbre `node_modules`.
 */
export const SKIPPED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  ".vite",
  ".cache",
  ".parcel-cache",
  "target",
  ".venv",
  "__pycache__",
]);

/**
 * Score d'un chemin pour une recherche approximative, ou `undefined` s'il ne
 * contient pas les lettres de la recherche dans l'ordre.
 *
 * Comme la palette de VS Code : les lettres peuvent être espacées (`trmar` trouve
 * `TerminalArea`), mais une suite de lettres collées, un début de mot et le nom du
 * fichier comptent plus qu'une lettre isolée au milieu d'un dossier. À score égal,
 * le chemin le plus court l'emporte.
 */
export function fuzzyScore(query: string, path: string): number | undefined {
  const needle = query.toLowerCase().replace(/\s+/g, "");
  if (!needle) return 0;
  const haystack = path.toLowerCase();
  const nameStart = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1;

  let score = 0;
  let from = 0;
  let previous = -2;
  for (const letter of needle) {
    const index = haystack.indexOf(letter, from);
    if (index === -1) return undefined;
    score += 1;
    if (index === previous + 1) score += 5;
    const before = path[index - 1];
    const wordStart =
      index === 0 ||
      before === "/" ||
      before === "\\" ||
      before === "-" ||
      before === "_" ||
      before === "." ||
      (path[index] !== haystack[index] && before !== undefined && before === before.toLowerCase());
    if (wordStart) score += 8;
    if (index >= nameStart) score += 3;
    previous = index;
    from = index + 1;
  }
  return score * 100 - path.length;
}

/**
 * Chemins des fichiers d'un projet, relatifs à sa racine et séparés par `/`.
 * Le parcours s'arrête à `maxFiles` : un projet démesuré rend une liste partielle
 * plutôt que de figer la recherche.
 */
export async function listProjectFiles(root: string, maxFiles = 20_000): Promise<string[]> {
  const found: string[] = [];
  const pending: string[] = [""];
  while (pending.length > 0 && found.length < maxFiles) {
    const relative = pending.shift() as string;
    let entries;
    try {
      entries = await readdir(join(root, relative), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) pending.push(path);
      } else if (entry.isFile()) {
        found.push(path);
        if (found.length >= maxFiles) break;
      }
    }
  }
  return found;
}

/** Les meilleurs chemins pour une recherche, du plus pertinent au moins pertinent. */
export function rankFiles(files: readonly string[], query: string, limit = 50): string[] {
  const scored: { path: string; score: number }[] = [];
  for (const path of files) {
    const score = fuzzyScore(query, path);
    if (score !== undefined) scored.push({ path, score });
  }
  scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return scored.slice(0, limit).map((item) => item.path);
}
