import { open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

/** Au-delà, un fichier ne s'ouvre pas dans l'éditeur : il le figerait. */
export const EDIT_LIMIT = 5 * 1024 * 1024;

const IMAGES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
};

/** Ce que l'éditeur reçoit d'un fichier. */
export type EditableFile =
  | {
      kind: "text";
      path: string;
      text: string;
      /** Horodatage lu : une écriture ne passe que s'il n'a pas changé depuis. */
      mtimeMs: number;
      size: number;
      /** Fin de ligne dominante, rendue telle quelle à l'écriture. */
      eol: "\n" | "\r\n";
      bom: boolean;
    }
  | { kind: "image"; path: string; mime: string; base64: string; mtimeMs: number; size: number }
  | { kind: "binary" | "too-large"; path: string; mtimeMs: number; size: number };

/** Le fichier a changé sur disque depuis qu'on l'a lu : l'écrire effacerait ce changement. */
export class ChangedOnDisk extends Error {
  constructor(
    path: string,
    readonly mtimeMs: number,
  ) {
    super(`${basename(path)} a changé sur disque depuis son ouverture`);
    this.name = "ChangedOnDisk";
  }
}

/** Fin de ligne la plus fréquente du texte ; `\n` à égalité ou sans ligne. */
export function dominantEol(text: string): "\n" | "\r\n" {
  const crlf = text.split("\r\n").length - 1;
  const lf = text.split("\n").length - 1 - crlf;
  return crlf > lf ? "\r\n" : "\n";
}

/**
 * Lit un fichier pour l'éditeur. Le texte arrive en `\n` : Monaco travaille ainsi,
 * et la fin de ligne d'origine revient à l'écriture. Un octet nul dans les
 * premiers kilo-octets le fait tenir pour binaire, comme git.
 */
export async function readEditable(path: string): Promise<EditableFile> {
  const info = await stat(path);
  if (!info.isFile()) throw new Error("pas un fichier");
  const base = { path, mtimeMs: info.mtimeMs, size: info.size };
  const mime = IMAGES[extname(path).toLowerCase()];
  if (mime) {
    if (info.size > EDIT_LIMIT) return { kind: "too-large", ...base };
    return { kind: "image", ...base, mime, base64: (await readFile(path)).toString("base64") };
  }
  if (info.size > EDIT_LIMIT) return { kind: "too-large", ...base };
  const bytes = await readFile(path);
  if (bytes.subarray(0, 8000).includes(0)) return { kind: "binary", ...base };
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const raw = bytes.subarray(bom ? 3 : 0).toString("utf8");
  return { kind: "text", ...base, text: raw.replace(/\r\n/g, "\n"), eol: dominantEol(raw), bom };
}

/** Horodatage d'un fichier, pour savoir s'il a changé sans le relire. */
export async function modifiedAt(path: string): Promise<number> {
  return (await stat(path)).mtimeMs;
}

/**
 * Écrit le texte de l'éditeur, sous la fin de ligne et le BOM d'origine.
 *
 * Refuse si le fichier a changé depuis la lecture (`expectedMtimeMs`) : Claude,
 * un autre éditeur ou git a pu l'écrire entre-temps. L'écriture passe par un
 * fichier voisin renommé : une coupure au milieu ne laisse pas un fichier tronqué.
 */
export async function writeEditable(
  path: string,
  text: string,
  options: { expectedMtimeMs: number; eol: "\n" | "\r\n"; bom: boolean },
): Promise<number> {
  const current = await modifiedAt(path);
  if (Math.abs(current - options.expectedMtimeMs) > 1) throw new ChangedOnDisk(path, current);
  const body = (options.bom ? "﻿" : "") + (options.eol === "\r\n" ? text.replace(/\r?\n/g, "\r\n") : text);
  const temporary = join(dirname(path), `.${basename(path)}.clide-${process.pid}-${Date.now()}.tmp`);
  try {
    await writeFile(temporary, body, "utf8");
    // Le fichier temporaire est vidé sur disque avant de prendre la place de l'original.
    const handle = await open(temporary, "r+");
    await handle.sync();
    await handle.close();
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return modifiedAt(path);
}
