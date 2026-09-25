import { readFile } from "node:fs/promises";
import { isAbsolute, join, sep } from "node:path";

import { structuredPatch } from "diff";

import { claudeHome, fileHistoryDir } from "../paths.js";
import type { FileTrack } from "../session/projection.js";

export interface FileDiff {
  trackingPath: string;
  /** Chemin résolu contre la racine du projet. */
  absolutePath: string;
  created: boolean;
  deleted: boolean;
  /** La sauvegarde attendue est introuvable : l'état « avant » ne peut pas être reconstitué. */
  beforeMissing: boolean;
  binary: boolean;
  linesAdded: number;
  linesRemoved: number;
  /** Diff au format unifié, en-têtes à la manière de git. Vide si rien n'a changé. */
  unified: string;
  /**
   * Dernière fois que la session a touché le fichier : l'horodatage de sa
   * sauvegarde la plus récente. Absent quand aucune n'en porte.
   */
  changedAt?: string;
}

/** Horodatage le plus récent des sauvegardes d'un fichier. */
function lastChange(track: FileTrack): string | undefined {
  let latest: string | undefined;
  for (const backup of track.backups) {
    if (backup.backupTime && (!latest || Date.parse(backup.backupTime) > Date.parse(latest))) latest = backup.backupTime;
  }
  return latest;
}

/** Nombre de lignes de contexte autour de chaque changement. */
const CONTEXT_LINES = 3;

function toPlatformPath(trackingPath: string): string {
  return trackingPath.split(/[\\/]/).join(sep);
}

function looksBinary(content: string): boolean {
  // Un octet nul dans les premiers kilo-octets suffit : c'est le test qu'utilise git.
  return content.slice(0, 8000).includes("\u0000");
}

function toPosix(path: string): string {
  return path.split(/[\\/]/).join("/");
}

/**
 * Reconstitue ce que la session a changé, fichier par fichier.
 *
 * L'état « avant » vient des sauvegardes pré-édition de Claude Code
 * (`~/.claude/file-history/<session>/`), pas de git : le diff décrit donc ce que
 * cette session a fait, indépendamment des commits et du reste de l'arbre de travail.
 * L'état « après » est le fichier tel qu'il est maintenant sur le disque.
 */
export class FileHistoryResolver {
  readonly #home: string;

  constructor(home: string = claudeHome()) {
    this.#home = home;
  }

  backupPath(sessionId: string, backupFileName: string): string {
    return join(fileHistoryDir(sessionId, this.#home), backupFileName);
  }

  /**
   * Première sauvegarde nommée d'un fichier, c'est-à-dire son état avant la
   * première édition de la session. Les versions suivantes décrivent des états
   * intermédiaires, pas le point de départ.
   */
  static firstNamedBackup(track: FileTrack): string | undefined {
    return track.backups.find((backup) => backup.backupFileName !== null)?.backupFileName ?? undefined;
  }

  async readBefore(
    sessionId: string,
    track: FileTrack,
  ): Promise<{ content: string; missing: boolean }> {
    if (track.created) return { content: "", missing: false };
    const name = FileHistoryResolver.firstNamedBackup(track);
    if (!name) return { content: "", missing: true };
    try {
      return { content: await readFile(this.backupPath(sessionId, name), "utf8"), missing: false };
    } catch {
      return { content: "", missing: true };
    }
  }

  async readAfter(
    projectRoot: string,
    track: FileTrack,
  ): Promise<{ content: string; exists: boolean; absolutePath: string }> {
    const relative = toPlatformPath(track.trackingPath);
    const absolutePath = isAbsolute(relative) ? relative : join(projectRoot, relative);
    try {
      return { content: await readFile(absolutePath, "utf8"), exists: true, absolutePath };
    } catch {
      return { content: "", exists: false, absolutePath };
    }
  }

  async diff(sessionId: string, track: FileTrack, projectRoot: string): Promise<FileDiff> {
    const before = await this.readBefore(sessionId, track);
    const after = await this.readAfter(projectRoot, track);
    const posix = toPosix(track.trackingPath);
    const changedAt = lastChange(track);

    const base: FileDiff = {
      trackingPath: track.trackingPath,
      absolutePath: after.absolutePath,
      created: track.created,
      deleted: !after.exists && !track.created,
      beforeMissing: before.missing,
      binary: looksBinary(before.content) || looksBinary(after.content),
      linesAdded: 0,
      linesRemoved: 0,
      unified: "",
      ...(changedAt ? { changedAt } : {}),
    };

    if (base.binary || before.missing) return base;

    const patch = structuredPatch(posix, posix, before.content, after.content, "", "", {
      context: CONTEXT_LINES,
    });

    let added = 0;
    let removed = 0;
    const body: string[] = [];
    for (const hunk of patch.hunks) {
      body.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
      for (const line of hunk.lines) {
        if (line.startsWith("+")) added += 1;
        else if (line.startsWith("-")) removed += 1;
        body.push(line);
      }
    }

    if (body.length === 0) return base;

    const oldLabel = track.created ? "/dev/null" : `a/${posix}`;
    const newLabel = base.deleted ? "/dev/null" : `b/${posix}`;
    return {
      ...base,
      linesAdded: added,
      linesRemoved: removed,
      unified: [`--- ${oldLabel}`, `+++ ${newLabel}`, ...body].join("\n"),
    };
  }

  /** Diff de tous les fichiers touchés par une session. */
  async diffSession(
    sessionId: string,
    files: readonly FileTrack[],
    projectRoot: string,
  ): Promise<FileDiff[]> {
    const out: FileDiff[] = [];
    for (const track of files) out.push(await this.diff(sessionId, track, projectRoot));
    return out.sort((a, b) => a.trackingPath.localeCompare(b.trackingPath));
  }
}
