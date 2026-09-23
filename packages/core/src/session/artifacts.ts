import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { claudeHome, isInside, projectsDir } from "../paths.js";

export interface SessionArtifact {
  path: string;
  /** Ce que c'est, pour le dire avant de le retirer. */
  role: "transcript" | "subagents" | "file-history" | "session-env";
  /** Octets, dossiers compris. */
  size: number;
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function sizeOf(path: string): Promise<number> {
  const info = await stat(path);
  if (!info.isDirectory()) return info.size;
  let total = 0;
  for (const entry of await readdir(path)) total += await sizeOf(join(path, entry));
  return total;
}

/**
 * Ce qu'une session laisse sur le disque.
 *
 * Son transcript, le dossier voisin qui porte ses sous-agents, les sauvegardes de
 * fichiers qu'a prises Claude Code et son environnement. Tout est composé à partir
 * de l'identifiant et du dossier projet, vérifiés, jamais d'un chemin reçu : ces
 * chemins partent à la corbeille, et un chemin fourni par l'appelant y enverrait
 * n'importe quoi.
 */
export async function sessionArtifacts(
  projectDir: string,
  sessionId: string,
  home: string = claudeHome(),
): Promise<SessionArtifact[]> {
  if (!ID.test(sessionId)) throw new Error(`identifiant de session invalide : ${sessionId}`);
  const projects = projectsDir(home);
  const folder = join(projects, projectDir);
  if (!isInside(projects, folder) || /[\\/]/.test(projectDir)) throw new Error("dossier projet invalide");

  const candidates: [string, SessionArtifact["role"]][] = [
    [join(folder, `${sessionId}.jsonl`), "transcript"],
    [join(folder, sessionId), "subagents"],
    [join(home, "file-history", sessionId), "file-history"],
    [join(home, "session-env", sessionId), "session-env"],
  ];
  const found: SessionArtifact[] = [];
  for (const [path, role] of candidates) {
    try {
      found.push({ path, role, size: await sizeOf(path) });
    } catch {
      // Absent : toutes les sessions n'ont pas de sous-agents ni de sauvegardes.
    }
  }
  return found;
}
