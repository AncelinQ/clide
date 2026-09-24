import { mkdir, readdir, rename, rm, rmdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Racine de configuration de Claude Code. `CLAUDE_CONFIG_DIR` prime, sinon `~/.claude`.
 */
export function claudeHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env["CLAUDE_CONFIG_DIR"];
  return override && override.length > 0 ? override : join(homedir(), ".claude");
}

/**
 * Encode un chemin projet comme le fait Claude Code pour nommer son dossier de
 * transcripts : tout caractère hors `[a-zA-Z0-9]` devient `-`.
 * `C:\Projets` donne `C--Projets`.
 */
export function encodeProjectPath(projectPath: string): string {
  return projectPath.replace(/[^a-zA-Z0-9]/g, "-");
}

export function projectsDir(home: string = claudeHome()): string {
  return join(home, "projects");
}

/**
 * Dossier des sauvegardes pré-édition d'une session, source de l'état « avant »
 * des diffs. Les fichiers y sont nommés `<hash>@v<n>`, valeur portée par
 * `file-history-delta.backup.backupFileName`.
 */
export function fileHistoryDir(sessionId: string, home: string = claudeHome()): string {
  return join(home, "file-history", sessionId);
}

export function settingsFile(home: string = claudeHome()): string {
  return join(home, "settings.json");
}

/**
 * Forme comparable d'un chemin.
 *
 * Le même dossier s'écrit de plusieurs façons : `C:\Projets\app`, `C:/Projets/app`,
 * avec ou sans barre finale, dans n'importe quelle casse. Git rend des barres
 * obliques, Windows en écrit d'autres, et Claude Code recopie ce qu'on lui donne.
 * Comparer des chemins bruts revient à rater une correspondance sur deux.
 */
export function normalizePath(path: string): string {
  return path
    .split(/[\\/]/)
    .filter((segment, index) => segment.length > 0 || index === 0)
    .join("/")
    .toLowerCase();
}

export function samePath(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b);
}

/** Vrai si `child` est à l'intérieur de `parent`, et non `parent` lui-même. */
export function isInside(parent: string, child: string): boolean {
  return normalizePath(child).startsWith(`${normalizePath(parent)}/`);
}

/**
 * Dossier de données de l'application, distinct de `~/.claude` : ce qui est
 * écrit ici appartient à Clide et peut être supprimé sans toucher à la
 * configuration de Claude Code.
 */
export function appDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(dataBase(env), "clide");
}

function dataBase(env: NodeJS.ProcessEnv): string {
  return env["LOCALAPPDATA"] ?? env["XDG_CACHE_HOME"] ?? join(homedir(), ".cache");
}

/** Dossier de données des installations antérieures au nom Clide. */
export function legacyAppDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(dataBase(env), "claude-ide");
}

/**
 * Reprend les données écrites sous l'ancien nom : index, schémas, rédactions,
 * sauvegardes de restauration, profil PowerShell.
 *
 * Chaque entrée de l'ancien dossier absente du nouveau y est déplacée ; une
 * entrée que le nouveau a déjà reste où elle est, jamais écrasée. Le nouveau
 * dossier peut en effet exister avant la migration — un premier lancement, une
 * suite de tests y régénèrent le profil PowerShell — sans rien porter de ce qui
 * compte. L'ancien dossier disparaît une fois vide.
 *
 * Un déplacement impossible — un ancien processus garde un fichier ouvert — est
 * rendu à l'appelant plutôt que levé : l'application démarre quand même, et ce
 * qui n'a pas suivi se reconstruit ou reste à reprendre au lancement suivant.
 */
/**
 * Entrées que l'application recrée à chaque lancement : le profil PowerShell et
 * le dossier où les hooks déposent leurs événements. Déjà présentes dans le
 * nouveau dossier, leur ancienne copie n'a plus rien à apporter.
 */
const REGENERATED = new Set(["pwsh", "hook-events"]);

export async function migrateAppData(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ moved: string[]; kept: string[]; from: string; to: string; error?: string }> {
  const from = legacyAppDataDir(env);
  const to = appDataDir(env);
  const moved: string[] = [];
  const kept: string[] = [];
  let entries: string[];
  try {
    entries = await readdir(from);
  } catch {
    return { moved, kept, from, to };
  }
  try {
    await mkdir(to, { recursive: true });
    for (const entry of entries) {
      if (await stat(join(to, entry)).catch(() => undefined)) {
        if (REGENERATED.has(entry)) await rm(join(from, entry), { recursive: true, force: true });
        else kept.push(entry);
        continue;
      }
      await rename(join(from, entry), join(to, entry));
      moved.push(entry);
    }
    if (kept.length === 0) await rmdir(from);
    return { moved, kept, from, to };
  } catch (error) {
    return { moved, kept, from, to, error: error instanceof Error ? error.message : String(error) };
  }
}

