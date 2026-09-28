import type { SessionSummary } from "@/lib/types";

export interface RecentProject {
  root: string;
  /** Sessions Claude lancées dans ce dossier. */
  sessions: number;
  lastActivityAt?: string;
}

/** Un dossier temporaire n'est pas un projet qu'on rouvre. */
const TEMPORARY = /[\\/]AppData[\\/]Local[\\/]Temp[\\/]/i;

/**
 * Les dossiers où des sessions ont tourné, du plus récent au plus ancien, avec
 * leur nombre de sessions : ce sont les projets qu'on rouvre. `projectDir` est le
 * nom encodé du dossier de transcripts ; seul `effectiveCwd` est un chemin. Les
 * projets déjà ouverts sont écartés, et la casse ne distingue pas deux dossiers.
 */
export function recentProjects(sessions: readonly SessionSummary[], open: readonly string[], limit = 8): RecentProject[] {
  const opened = new Set(open.map((root) => root.toLowerCase()));
  const byRoot = new Map<string, RecentProject>();
  for (const session of sessions) {
    const root = session.effectiveCwd?.replace(/[\\/]+$/, "");
    if (!root || TEMPORARY.test(`${root}\\`) || opened.has(root.toLowerCase())) continue;
    const key = root.toLowerCase();
    const known = byRoot.get(key);
    const last = session.lastActivityAt;
    if (!known) {
      byRoot.set(key, { root, sessions: 1, ...(last ? { lastActivityAt: last } : {}) });
      continue;
    }
    known.sessions++;
    if (last && (!known.lastActivityAt || last > known.lastActivityAt)) known.lastActivityAt = last;
  }
  return [...byRoot.values()].sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? "")).slice(0, limit);
}
