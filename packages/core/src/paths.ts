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
 * écrit ici appartient à claude-ide et peut être supprimé sans toucher à la
 * configuration de Claude Code.
 */
export function appDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const base = env["LOCALAPPDATA"] ?? env["XDG_CACHE_HOME"] ?? join(homedir(), ".cache");
  return join(base, "claude-ide");
}

