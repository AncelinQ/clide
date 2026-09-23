import { open, stat } from "node:fs/promises";
import { extname } from "node:path";

import { resolveInside } from "./browser.js";

/** Au-delà, le texte est tronqué : un aperçu sert à reconnaître, pas à tout lire. */
export const TEXT_LIMIT = 256 * 1024;
/** Au-delà, l'image n'est pas envoyée : elle passerait en base64 dans du JSON. */
export const IMAGE_LIMIT = 8 * 1024 * 1024;

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".avif": "image/avif",
};

export type FilePreview =
  | { kind: "text"; path: string; size: number; text: string; truncated: boolean }
  | { kind: "image"; path: string; size: number; mime: string; base64: string }
  | { kind: "binary"; path: string; size: number }
  | { kind: "too-large"; path: string; size: number };

async function readHead(path: string, length: number): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Aperçu d'un fichier du projet.
 *
 * Le chemin est borné à la racine, comme pour la liste des dossiers : il vient
 * d'une requête HTTP. Un fichier est tenu pour binaire s'il porte un octet nul
 * dans ses premiers kilo-octets — c'est ce que fait git. Le SVG, qui est du texte,
 * est montré comme tel : le rendre demanderait d'exécuter ce qu'il contient.
 */
export async function previewFile(root: string, requested: string): Promise<FilePreview> {
  const path = resolveInside(root, requested);
  const info = await stat(path);
  if (!info.isFile()) throw new Error("pas un fichier");
  const size = info.size;

  const mime = IMAGE_TYPES[extname(path).toLowerCase()];
  if (mime) {
    if (size > IMAGE_LIMIT) return { kind: "too-large", path, size };
    const bytes = await readHead(path, size);
    return { kind: "image", path, size, mime, base64: bytes.toString("base64") };
  }

  const head = await readHead(path, Math.min(size, TEXT_LIMIT));
  if (head.subarray(0, 8000).includes(0)) return { kind: "binary", path, size };

  // Une coupe au milieu d'un caractère multi-octet donnerait un « � » final : on
  // recule jusqu'au début du dernier caractère entier.
  let end = head.length;
  if (size > TEXT_LIMIT) {
    while (end > 0 && ((head[end - 1] ?? 0) & 0xc0) === 0x80) end--;
    if (end > 0 && (head[end - 1] ?? 0) >= 0xc0) end--;
  }
  return {
    kind: "text",
    path,
    size,
    text: head.subarray(0, end).toString("utf8"),
    truncated: size > TEXT_LIMIT,
  };
}
