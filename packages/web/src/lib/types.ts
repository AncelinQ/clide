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
  /** Adresse locale annoncée par la commande en cours : un serveur de développement. */
  devUrl?: string;
  /** Projet de l'interface qui l'a ouvert, même quand l'onglet vit dans un worktree. */
  owner?: string;
  /** Script que l'onglet fait tourner (`dossier|nom`). */
  script?: string;
}

/** Coût d'une session, avec ce qu'il vaut : relevé, estimé, plancher ou inconnu. */
export type SessionCost =
  | { kind: "exact"; usd: number }
  | { kind: "estimated"; usd: number }
  | { kind: "atLeast"; usd: number; unpriced: string[] }
  | { kind: "unknown"; unpriced: string[] };

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
  price?: SessionCost;
  /** Ticket porté par la branche de la session. */
  ticket?: string;
  prLinks: { prUrl?: string; prNumber?: number }[];
}

export interface DirectoryEntry {
  name: string;
  directory: boolean;
  relativePath: string;
  path: string;
  /** Des sessions Claude ont été lancées dans ce dossier. */
  hasSessions?: boolean;
  /** Git ignore cette entrée : montrée seulement avec les fichiers cachés, en retrait. */
  ignored?: boolean;
}

/** Un plan de `~/.claude/plans`. */
export interface PlanFileInfo {
  path: string;
  name: string;
  modifiedAt: string;
  title?: string;
}

export interface DirectoryListing {
  root: string;
  relativePath: string;
  entries: DirectoryEntry[];
  breadcrumb: { name: string; relativePath: string }[];
}

export interface Skill {
  /** Nom d'invocation, celui de `/nom` : le nom du dossier. */
  name: string;
  /** `name` du frontmatter, quand il diffère du dossier. */
  declaredName?: string;
  directory: string;
  description?: string;
  invocation: "auto-and-slash" | "manual-only" | "auto-only";
  /** Un skill de plugin ou synchronisé se lit seulement : il ne vit pas sur ce poste. */
  scope: "user" | "project" | "plugin" | "synced";
  path: string;
  plugin?: string;
  /** Fournisseur d'un skill synchronisé depuis claude.ai. */
  origin?: "anthropic" | "organisation";
  /** Dossier lié dont vient le skill : il appartient à cet autre dépôt, et se lit d'ici. */
  linkedFrom?: string;
}

export interface SlashCommand {
  name: string;
  scope: "user" | "project";
  description?: string;
}

export interface McpServer {
  name: string;
  scope: "project" | "local" | "user" | "linked";
  transport: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  redacted: boolean;
  /** Dossier dont vient le serveur : dossier lié, ou autre projet. */
  source?: string;
}

export interface McpStatus {
  name: string;
  health: "connected" | "needs-auth" | "failed";
  detail?: string;
  connector: boolean;
}

export interface ProjectScripts {
  /** Scripts des dossiers liés, chacun avec son propre gestionnaire. */
  linked?: ProjectScripts[];
  root: string;
  manager: string;
  managerDetected: boolean;
  sources: { directory: string; relativePath: string; packageName?: string; scripts: { name: string; command: string }[] }[];
  /** Les autres outils du dossier : make, cargo, go, python, scripts PowerShell et shell. */
  tools: { tool: string; directory: string; commands: { name: string; run: string }[] }[];
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
  /** Écrit par une commande Bash : diff relevé par Claude Code, pas de sauvegarde. */
  viaBash: boolean;
  linesAdded: number;
  linesRemoved: number;
  unified: string;
  /** Dernière modification du fichier par la session. */
  changedAt?: string;
}

export type ActivityEntry =
  | { kind: "prompt"; at?: string; text: string; images?: number }
  | { kind: "command" | "note"; at?: string; text: string }
  | { kind: "answer"; at?: string; text: string; model?: string }
  | { kind: "tool"; at?: string; name: string; summary: string; failed?: boolean; agentId?: string; images?: number };

export interface ProcessNode {
  pid: number;
  name: string;
  commandLine?: string;
  memoryMB: number;
  startedAt?: string;
  link: { kind: "owned"; terminalId: string } | { kind: "inferred"; confidence: number } | { kind: "orphan" };
  children: ProcessNode[];
}

export type NotificationKind = "permission" | "idle" | "stop" | "resume" | "session" | "other";

export interface ClaudeNotification {
  id: string;
  kind: NotificationKind;
  receivedAt: string;
  cwd?: string;
  message?: string;
}

export type FilePreview =
  | { kind: "text"; path: string; size: number; text: string; truncated: boolean }
  | { kind: "image"; path: string; size: number; mime: string; base64: string }
  | { kind: "binary"; path: string; size: number }
  | { kind: "too-large"; path: string; size: number };

export interface HooksStatus {
  installed: boolean;
  /** Le script déposé n'est plus celui de cette version : réinstaller le remplace. */
  outdated: boolean;
  kinds: NotificationKind[];
  /** Hooks d'installations antérieures encore déclarés, par script, avec leurs événements. */
  legacy: { script: string; events: string[] }[];
  settingsPath: string;
}

export interface SettingsDocument {
  path: string;
  raw: string;
  value: Record<string, unknown>;
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  context: number;
  model?: string;
  effort?: string;
}

/** Session qui tourne dans un onglet Claude, suivie en direct par le serveur. */
export interface LiveSession {
  sessionId: string;
  title?: string;
  permissionMode?: string;
  planMode?: boolean;
  tokens?: TokenUsage;
  cost?: { totalCostUSD?: number };
  price?: SessionCost;
  queue?: { text: string; at?: string }[];
  lastActivityAt?: string;
}

/** Messages poussés par le serveur sur la connexion des terminaux. */
export type ServerMessage =
  | { t: "hello"; terminals: TerminalInfo[]; backlogs: Record<string, string> }
  | { t: "opened"; terminal: TerminalInfo }
  | { t: "data"; id: string; data: string }
  | { t: "state"; terminal: TerminalInfo }
  | { t: "exit"; id: string; exitCode: number }
  | { t: "notification"; notification: ClaudeNotification; terminalId?: string }
  | { t: "resume"; terminalId: string }
  | { t: "live"; terminalId: string; session: LiveSession }
  | { t: "error"; message: string }
  | { t: "diagnostics"; report: DiagnosticsReport }
  | { t: "browser"; state: BrowserState }
  | { t: "browser.frame"; frame: BrowserFrame };

/** Le navigateur que Claude pilote par son MCP : lancé ou non, ses pages, celle montrée. */
export interface BrowserState {
  status: "stopped" | "starting" | "running" | "error";
  error?: string;
  port: number;
  pages: { id: string; url: string; title: string }[];
  current?: string;
}

/** Une image de la page montrée (JPEG en base64), et sa taille en pixels CSS. */
export interface BrowserFrame {
  data: string;
  width: number;
  height: number;
}

/** Une erreur, un avertissement ou un TODO, à une place d'un fichier (lignes et colonnes à partir de 1). */
export interface Diagnostic {
  path: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "info";
  message: string;
  source: "tsc" | "eslint" | "todo";
  code?: string;
}

export interface DiagnosticsReport {
  root: string;
  tools: { tool: Diagnostic["source"]; ranAt: string; durationMs: number; diagnostics: Diagnostic[]; error?: string }[];
}

/** Une limite de l'abonnement ; `kind` reprend les noms de l'API d'usage. */
export interface UsageLimit {
  kind: string;
  percent: number;
  resetsAt?: string;
  model?: string;
  severity?: string;
}

export interface UsageReading {
  at: string;
  limits: UsageLimit[];
}

/** Ce que la ligne de statut a vu d'une session. */
export interface SessionUsage {
  sessionId: string;
  at: string;
  model?: string;
  cwd?: string;
  costUsd?: number;
  durationMs?: number;
  linesAdded?: number;
  linesRemoved?: number;
  contextPercent?: number;
  contextSize?: number;
}

export interface UsageReport {
  statusline: { installed: boolean; foreign?: string; command: string };
  live: UsageReading | null;
  api: (UsageReading & { subscription?: string }) | null;
  sessions: SessionUsage[];
}

/** Un test lu dans son fichier (ligne à partir de 1), avec les blocs qui l'englobent. */
export interface TestCase {
  name: string;
  line: number;
  parents: string[];
}

export interface TestResult {
  /** Chemin relatif au dossier de la suite, séparé par `/`. */
  path: string;
  name: string;
  parents: string[];
  status: "passed" | "failed" | "skipped";
  durationMs?: number;
  failure?: string;
}

/** Les tests d'un package, le rapport que sa commande écrit, et ses derniers résultats. */
export interface TestSuite {
  framework: "vitest" | "jest" | "pytest";
  directory: string;
  files: { path: string; tests: TestCase[] }[];
  reportPath: string;
  results: TestResult[];
}
