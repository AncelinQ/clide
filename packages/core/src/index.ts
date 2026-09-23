export {
  appDataDir,
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
  type FileTrack,
  type SessionProjection,
  type TokenUsage,
} from "./session/projection.js";
export { findLiveTranscript, resumedSessionId, type TranscriptMatch } from "./transcript/live.js";

export {
  extractPlan,
  planProgress,
  type PlanLookup,
  type PlanProgress,
  type SessionPlan,
} from "./session/plan.js";

export {
  buildActivity,
  summarizeTool,
  type ActivityEntry,
  type ActivityFeed,
} from "./session/activity.js";

export {
  SessionIndex,
  type IndexedSession,
  type RefreshReport,
} from "./session/session-index.js";

export { FileHistoryResolver, type FileDiff } from "./files/history.js";

export {
  breadcrumb,
  listDirectory,
  resolveInside,
  type DirectoryEntry,
  type DirectoryListing,
} from "./files/browser.js";
export { IMAGE_LIMIT, TEXT_LIMIT, previewFile, type FilePreview } from "./files/preview.js";

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
  type Skill,
  type SkillInvocation,
  type SlashCommand,
} from "./skills/store.js";

export {
  McpStore,
  MASK,
  redactServer,
  safeServerName,
  type McpScope,
  type McpServer,
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
