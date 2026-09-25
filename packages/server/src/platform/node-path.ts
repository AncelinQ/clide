import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Exécutable Node des scripts que Claude Code lance pour nous : hooks, ligne de
 * statut.
 *
 * Hors Electron, c'est le Node qui fait tourner le serveur, par son chemin
 * absolu : Claude Code exécute ces commandes dans son propre environnement, dont
 * le PATH n'est pas le nôtre. Sous Electron, `process.execPath` est `Clide.exe` :
 * l'inscrire relancerait l'application à chaque événement au lieu d'exécuter le
 * script. Le Node du PATH est retenu à sa place, ou l'installation est refusée.
 */
export async function nodeExecutable(): Promise<string> {
  if (!process.versions.electron) return process.execPath;
  try {
    const { stdout } = await run("where.exe", ["node"], { windowsHide: true, timeout: 5000 });
    const found = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.toLowerCase().endsWith(".exe"));
    if (found) return found;
  } catch {
    // `where` sort en erreur quand rien ne correspond.
  }
  throw new Error("Node.js est introuvable dans le PATH : il en faut un pour les scripts que Claude Code lance");
}
