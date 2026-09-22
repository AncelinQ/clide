/**
 * Formes rendues par l'API.
 *
 * Elles doublent les types du serveur plutôt que de les importer : le client est
 * construit à part, et le faire dépendre du paquet serveur tirerait Node dans un
 * paquet qui tourne dans un navigateur. Le contrat est l'API, pas le typage.
 */

export type TerminalKind = "shell" | "claude";
export type TerminalState = "idle" | "running" | "failed";

export interface TerminalInfo {
  id: string;
  kind: TerminalKind;
  projectRoot: string;
  cwd: string;
  state: TerminalState;
  lastExitCode?: number;
  title: string;
  exited: boolean;
}

export interface SessionSummary {
  sessionId: string;
  projectDir: string;
  title?: string;
  lastPrompt?: string;
  effectiveCwd?: string;
  gitBranch?: string;
  startedAt?: string;
  lastActivityAt?: string;
  messageCount: number;
  fileCount: number;
  cost?: { totalCostUSD?: number; totalLinesAdded?: number; totalLinesRemoved?: number };
  prLinks: { prUrl?: string; prNumber?: number }[];
}

export interface DirectoryEntry {
  name: string;
  directory: boolean;
  relativePath: string;
  path: string;
}

export interface DirectoryListing {
  root: string;
  relativePath: string;
  entries: DirectoryEntry[];
  breadcrumb: { name: string; relativePath: string }[];
}

export interface Skill {
  name: string;
  directory: string;
  description?: string;
  invocation: "auto-and-slash" | "manual-only" | "auto-only";
  scope: "user" | "project";
  path: string;
}

export interface SlashCommand {
  name: string;
  scope: "user" | "project";
  description?: string;
}

export interface McpServer {
  name: string;
  scope: "project" | "local" | "user";
  transport: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  redacted: boolean;
}

export interface McpStatus {
  name: string;
  health: "connected" | "needs-auth" | "failed";
  detail?: string;
  connector: boolean;
}

export interface ProjectScripts {
  manager: string;
  managerDetected: boolean;
  sources: { directory: string; relativePath: string; packageName?: string; scripts: { name: string; command: string }[] }[];
}

export interface ProjectLink {
  path: string;
  role?: string;
  readOnly: boolean;
}

export interface Worktree {
  path: string;
  branch?: string;
  head?: string;
  main: boolean;
  detached: boolean;
  locked?: string;
  prunable?: string;
  dirty?: number;
  ahead?: number;
  behind?: number;
  sessions: { sessionId: string; title?: string }[];
}

export interface FileDiff {
  trackingPath: string;
  created: boolean;
  deleted: boolean;
  binary: boolean;
  beforeMissing: boolean;
  linesAdded: number;
  linesRemoved: number;
  unified: string;
}

export type ActivityEntry =
  | { kind: "prompt" | "command" | "note"; at?: string; text: string }
  | { kind: "answer"; at?: string; text: string; model?: string }
  | { kind: "tool"; at?: string; name: string; summary: string; failed?: boolean };

export interface ProcessNode {
  pid: number;
  name: string;
  commandLine?: string;
  memoryMB: number;
  link: { kind: "owned"; terminalId: string } | { kind: "inferred"; confidence: number } | { kind: "orphan" };
  children: ProcessNode[];
}

export type NotificationKind = "permission" | "idle" | "stop" | "other";

export interface ClaudeNotification {
  id: string;
  kind: NotificationKind;
  receivedAt: string;
  cwd?: string;
  message?: string;
}

export interface HooksStatus {
  installed: boolean;
  kinds: NotificationKind[];
  settingsPath: string;
}

export interface SettingsDocument {
  path: string;
  raw: string;
  value: Record<string, unknown>;
}

/** Messages poussés par le serveur sur la connexion des terminaux. */
export type ServerMessage =
  | { t: "hello"; terminals: TerminalInfo[] }
  | { t: "opened"; terminal: TerminalInfo }
  | { t: "data"; id: string; data: string }
  | { t: "state"; terminal: TerminalInfo }
  | { t: "exit"; id: string; exitCode: number }
  | { t: "notification"; notification: ClaudeNotification; terminalId?: string }
  | { t: "error"; message: string };
