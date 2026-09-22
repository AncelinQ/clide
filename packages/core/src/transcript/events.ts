/**
 * Enveloppe d'un event de transcript.
 *
 * Le type reste ouvert et l'index signature conserve tout champ non décrit ici :
 * le format n'est pas documenté par Claude Code et évolue. Un event inconnu doit
 * traverser la lecture sans la faire échouer.
 */
export interface TranscriptEvent {
  type: string;
  sessionId?: string;
  timestamp?: string;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  uuid?: string;
  parentUuid?: string | null;
  /** Marque les messages émis par un sous-agent plutôt que par la session principale. */
  isSidechain?: boolean;
  [key: string]: unknown;
}

/**
 * Types rencontrés dans le corpus de référence. Sert à distinguer « je sais quoi
 * faire de cet event » de « ce type est apparu depuis » — jamais à rejeter un event.
 */
export const KNOWN_EVENT_TYPES = [
  "agent-name",
  "ai-title",
  "artifact-autoreact-ledger",
  "artifact-comment-monitor",
  "assistant",
  "atis-latch",
  "attachment",
  "bridge-session",
  "continued-in",
  "cost-state",
  "file-history-delta",
  "file-history-snapshot",
  "frame-link",
  "last-prompt",
  "mode",
  "permission-mode",
  "pr-link",
  "queue-operation",
  "relocated",
  "system",
  "user",
  "worktree-state",
] as const;

export type KnownEventType = (typeof KNOWN_EVENT_TYPES)[number];

const KNOWN = new Set<string>(KNOWN_EVENT_TYPES);

export function isKnownEventType(type: string): type is KnownEventType {
  return KNOWN.has(type);
}

/**
 * État d'un fichier avant une édition, référencé par `file-history-delta`.
 *
 * `backupFileName` vaut `null` quand le fichier n'existait pas : il n'y a rien à
 * sauvegarder et le diff part du vide. `realParentDir` dit alors où il a été créé.
 */
export interface FileBackupRef {
  backupFileName: string | null;
  version: number;
  backupTime?: string;
  realParentDir?: string;
}

export interface CostState {
  totalCostUSD?: number;
  totalLinesAdded?: number;
  totalLinesRemoved?: number;
  totalDuration?: number;
  totalAPIDuration?: number;
  startTime?: string;
  modelUsage?: Record<string, unknown>;
}

export interface WorktreeSession {
  originalCwd?: string;
  preEnterOriginalCwd?: string;
  worktreePath?: string;
}

export interface PrLink {
  prNumber?: number;
  prUrl?: string;
  prRepository?: string;
  timestamp?: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function readString(event: TranscriptEvent, key: string): string | undefined {
  const value = event[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function readNumber(event: TranscriptEvent, key: string): number | undefined {
  const value = event[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function readBackupRef(event: TranscriptEvent): FileBackupRef | undefined {
  const backup = asRecord(event["backup"]);
  if (!backup) return undefined;
  const name = backup["backupFileName"];
  const version = backup["version"];
  const backupTime = backup["backupTime"];
  const realParentDir = backup["realParentDir"];
  return {
    backupFileName: typeof name === "string" && name.length > 0 ? name : null,
    version: typeof version === "number" ? version : 1,
    ...(typeof backupTime === "string" ? { backupTime } : {}),
    ...(typeof realParentDir === "string" ? { realParentDir } : {}),
  };
}

export function readCostState(event: TranscriptEvent): CostState | undefined {
  const usd = readNumber(event, "totalCostUSD");
  if (usd === undefined) return undefined;
  const modelUsage = asRecord(event["modelUsage"]);
  return {
    totalCostUSD: usd,
    ...(readNumber(event, "totalLinesAdded") !== undefined
      ? { totalLinesAdded: readNumber(event, "totalLinesAdded") }
      : {}),
    ...(readNumber(event, "totalLinesRemoved") !== undefined
      ? { totalLinesRemoved: readNumber(event, "totalLinesRemoved") }
      : {}),
    ...(readNumber(event, "totalDuration") !== undefined
      ? { totalDuration: readNumber(event, "totalDuration") }
      : {}),
    ...(readNumber(event, "totalAPIDuration") !== undefined
      ? { totalAPIDuration: readNumber(event, "totalAPIDuration") }
      : {}),
    ...(readString(event, "startTime") ? { startTime: readString(event, "startTime") } : {}),
    ...(modelUsage ? { modelUsage } : {}),
  };
}

export function readWorktreeSession(event: TranscriptEvent): WorktreeSession | undefined {
  const session = asRecord(event["worktreeSession"]);
  if (!session) return undefined;
  const pick = (key: string): string | undefined =>
    typeof session[key] === "string" ? (session[key] as string) : undefined;
  return {
    ...(pick("originalCwd") ? { originalCwd: pick("originalCwd") } : {}),
    ...(pick("preEnterOriginalCwd") ? { preEnterOriginalCwd: pick("preEnterOriginalCwd") } : {}),
    ...(pick("worktreePath") ? { worktreePath: pick("worktreePath") } : {}),
  };
}
