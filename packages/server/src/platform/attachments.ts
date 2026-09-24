import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";

import { appDataDir } from "@clide/core";

/** Une capture d'écran en haute définition tient en quelques mégaoctets. */
export const ATTACHMENT_LIMIT = 20 * 1024 * 1024;

/** Seules les images s'enregistrent : c'est ce que Claude Code sait lire d'un chemin tapé. */
const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
};

export function attachmentsDir(dataDir: string = appDataDir()): string {
  return join(dataDir, "drops");
}

/** Corps brut d'une requête, refusé au-delà de la limite plutôt que tronqué. */
export function readRawBody(request: IncomingMessage, limit: number = ATTACHMENT_LIMIT): Promise<Buffer> {
  return new Promise((done, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        fail(new Error("image trop volumineuse"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => done(Buffer.concat(chunks)));
    request.on("error", fail);
  });
}

function stamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/**
 * Enregistre une image collée, déposée ou capturée, et rend son chemin.
 *
 * Le chemin est ce qu'on tape dans le prompt : Claude Code lit une image désignée
 * par son chemin, pas un contenu collé. Le nom porte l'heure, pour qu'on retrouve
 * la capture, et un suffixe aléatoire, pour que deux collages dans la même
 * seconde ne s'écrasent pas.
 */
export async function saveAttachment(mime: string, bytes: Buffer, dataDir: string = appDataDir()): Promise<string> {
  const extension = EXTENSIONS[mime.split(";")[0]?.trim().toLowerCase() ?? ""];
  if (!extension) throw new Error(`type non pris en charge : ${mime}`);
  if (bytes.length === 0) throw new Error("image vide");
  const directory = attachmentsDir(dataDir);
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${stamp(new Date())}-${randomBytes(3).toString("hex")}.${extension}`);
  await writeFile(path, bytes);
  return path;
}
