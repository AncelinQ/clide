import { readdir, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

import { isInside, samePath } from "../paths.js";

export interface DirectoryEntry {
  name: string;
  directory: boolean;
  /** Chemin relatif à la racine du projet, séparateurs de la plateforme. */
  relativePath: string;
  path: string;
  size?: number;
  mtimeMs?: number;
}

export interface DirectoryListing {
  root: string;
  path: string;
  /** Chemin relatif affichable, vide à la racine. */
  relativePath: string;
  /** Dossier parent, absent quand on est déjà à la racine. */
  parent?: string;
  entries: DirectoryEntry[];
}

/** Dossiers dont le contenu n'intéresse personne dans un explorateur de projet. */
const HIDDEN = new Set(["node_modules", "Thumbs.db"]);

/**
 * Résout un chemin demandé sous la racine d'un projet, ou refuse.
 *
 * Le chemin vient d'une requête HTTP : un `..`, ou un chemin absolu, y ramènerait
 * n'importe quel fichier de la machine.
 */
export function resolveInside(root: string, requested: string): string {
  const rootResolved = resolve(root);
  const target = resolve(rootResolved, requested);
  if (!samePath(target, rootResolved) && !isInside(rootResolved, target)) {
    throw new Error("chemin hors du projet");
  }
  return target;
}

/**
 * Liste un dossier du projet.
 *
 * Le chemin demandé est borné à la racine du projet : il vient d'une requête
 * HTTP, et un `..` y ramènerait le contenu de n'importe quel dossier de la
 * machine. Les dossiers passent avant les fichiers, chaque groupe trié par nom —
 * c'est l'ordre qu'on attend d'un explorateur, pas l'ordre du système de fichiers.
 */
export async function listDirectory(
  root: string,
  requested = "",
  options: { hidden?: boolean } = {},
): Promise<DirectoryListing> {
  const rootResolved = resolve(root);
  const target = resolveInside(rootResolved, requested);

  const names = await readdir(target, { withFileTypes: true });
  const entries: DirectoryEntry[] = [];

  for (const entry of names) {
    // Les fichiers cachés sont écartés par défaut : ils encombrent la liste et
    // ne sont pas ce qu'on glisse dans un prompt. `options.hidden` les ramène.
    if (HIDDEN.has(entry.name)) continue;
    if (!options.hidden && entry.name.startsWith(".")) continue;
    const path = join(target, entry.name);
    const directory = entry.isDirectory();
    let size: number | undefined;
    let mtimeMs: number | undefined;
    try {
      const info = await stat(path);
      mtimeMs = info.mtimeMs;
      if (!directory) size = info.size;
    } catch {
      // Lien cassé ou fichier disparu entre la lecture et la mesure : il reste
      // listé, sans ses détails.
    }
    entries.push({
      name: entry.name,
      directory,
      relativePath: relative(rootResolved, path),
      path,
      ...(size !== undefined ? { size } : {}),
      ...(mtimeMs !== undefined ? { mtimeMs } : {}),
    });
  }

  entries.sort((a, b) => {
    if (a.directory !== b.directory) return a.directory ? -1 : 1;
    return a.name.localeCompare(b.name, "fr", { numeric: true });
  });

  const relativePath = relative(rootResolved, target);
  return {
    root: rootResolved,
    path: target,
    relativePath,
    ...(relativePath.length > 0 ? { parent: join(target, "..") } : {}),
    entries,
  };
}

/** Segments cliquables du fil d'Ariane, de la racine au dossier courant. */
export function breadcrumb(listing: DirectoryListing): { name: string; relativePath: string }[] {
  const segments = listing.relativePath.length > 0 ? listing.relativePath.split(sep) : [];
  const out = [{ name: listing.root.split(/[\\/]/).pop() ?? listing.root, relativePath: "" }];
  let accumulated = "";
  for (const segment of segments) {
    accumulated = accumulated.length > 0 ? join(accumulated, segment) : segment;
    out.push({ name: segment, relativePath: accumulated });
  }
  return out;
}
