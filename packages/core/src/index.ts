export {
  appDataDir,
  legacyAppDataDir,
  roamingDir,
  migrateAppData,
  claudeHome,
  isInside,
  normalizePath,
  samePath,
  encodeProjectPath,
  fileHistoryDir,
  projectsDir,
  settingsFile,
} from "./paths.js";

export {
  KNOWN_EVENT_TYPES,
  isKnownEventType,
  type CostState,
  type FileBackupRef,
  type KnownEventType,
  type PrLink,
  type TranscriptEvent,
  type WorktreeSession,
} from "./transcript/events.js";

export { JsonlTailer, parseLine, type TailResult } from "./transcript/jsonl.js";

export {
  classifyTranscript,
  discoverTranscripts,
  type TranscriptKind,
  type TranscriptRef,
} from "./transcript/discover.js";

export {
  TranscriptReader,
  readTranscript,
  type PollResult,
  type ReadStats,
} from "./transcript/reader.js";

export {
  SessionProjector,
  projectEvents,
  type BashEdit,
  type FileTrack,
  type QueuedPrompt,
  type SessionProjection,
  type TokenCounts,
  type TokenUsage,
} from "./session/projection.js";
export {
  calibrate,
  mergeUsage,
  modelKey,
  priceOf,
  samplesOf,
  sessionCost,
  type Calibration,
  type CostSample,
  type Rates,
  type SessionCost,
} from "./cost/pricing.js";
export { findLiveTranscript, resumedSessionId, type TranscriptMatch } from "./transcript/live.js";

export {
  extractPlan,
  planProgress,
  type PlanLookup,
  type PlanProgress,
  type SessionPlan,
} from "./session/plan.js";
export { listPlans, readPlanFile, withPlanFile, type PlanFileInfo } from "./session/plan-file.js";

export {
  buildActivity,
  summarizeTool,
  type ActivityDetail,
  type ActivityEntry,
  type ActivityFeed,
  type ActivityImage,
} from "./session/activity.js";

export {
  SessionIndex,
  type IndexedSession,
  type RefreshReport,
} from "./session/session-index.js";

export { FileHistoryResolver, type FileDiff } from "./files/history.js";
export { DIGEST_MAX, diagramInstructions, extractMermaid, sessionDigest, type SessionDigest } from "./session/diagram.js";
export { commitInstructions, mrInstructions, unfence, type WriteupKind } from "./session/writeup.js";
export {
  applyRestore,
  lastSessionWrites,
  planRestore,
  type RestoreAction,
  type RestorePlan,
} from "./files/restore.js";

export {
  breadcrumb,
  listDirectory,
  markSessions,
  resolveInside,
  type DirectoryEntry,
  type DirectoryListing,
} from "./files/browser.js";
export { IMAGE_LIMIT, TEXT_LIMIT, previewFile, type FilePreview } from "./files/preview.js";
export { SKIPPED_DIRECTORIES, fuzzyScore, listProjectFiles, rankFiles } from "./files/find.js";
export { checkName, createEntry, keepBothName, renameEntry, transfer, type OnConflict, type Outcome } from "./files/operations.js";
export { ChangedOnDisk, EDIT_LIMIT, dominantEol, modifiedAt, readEditable, writeEditable, type EditableFile } from "./files/editing.js";
export {
  LOG_FORMAT,
  graphRows,
  parseChanges,
  parseCommits,
  parseNameStatus,
  type Change,
  type ChangeKind,
  type Commit,
  type CommitFile,
  type GraphRow,
} from "./git/history.js";

export {
  SettingsEditor,
  SettingsParseError,
  type SettingsDocument,
  type SettingsEdit,
} from "./settings/editor.js";

export {
  SkillStore,
  parseFrontmatter,
  renderSkill,
  safeDirectoryName,
  type SkillDraft,
  type Scope,
  type SkillScope,
  type SkillOrigin,
  type Skill,
  type SkillInvocation,
  type SlashCommand,
} from "./skills/store.js";

export {
  McpStore,
  MASK,
  redactServer,
  restoreMasked,
  safeServerName,
  type McpScope,
  type McpServer,
  type McpSourceScope,
  type McpTransport,
} from "./mcp/store.js";

export { parseMcpStatus, type McpHealth, type McpStatus } from "./mcp/status.js";

export {
  ScriptStore,
  parsePnpmWorkspace,
  type PackageManager,
  type PackageScript,
  type ProjectScripts,
  type ScriptSource,
} from "./scripts/store.js";

export {
  LinkStore,
  denyRules,
  promptPath,
  LINKS_PROMPT,
  LINKS_ROLES,
  LINKS_SETTINGS,
  type ProjectLink,
} from "./links/store.js";

export { sessionArtifacts, type SessionArtifact } from "./session/artifacts.js";
export { TicketTracker, ticketOfBranch, type TicketTrace } from "./work/tickets.js";
export { buildChantiers, type Chantier, type ChantierRelation, type ChantierSession } from "./work/chantiers.js";
export { SearchIndex, fold, type SearchHit, type SearchResult } from "./search/search-index.js";
