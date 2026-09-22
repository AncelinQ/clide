export { startServer, type RunningServer, type ServerOptions } from "./server.js";
export { mutations, routes, type ApiContext, type Handler } from "./api/routes.js";
export {
  HOOK_DEFINITIONS,
  eventsDir,
  hookCommand,
  hookScript,
  hookScriptPath,
  hooksStatus,
  installHooks,
  uninstallHooks,
  type HooksStatus,
  type NotificationKind,
} from "./notifications/hook.js";
export {
  NotificationWatcher,
  parseNotification,
  type ClaudeNotification,
} from "./notifications/watcher.js";
export {
  ProcessLister,
  buildProcessTree,
  flatten,
  isClaudeProcess,
  parseProcessList,
  type ProcessLink,
  type ProcessNode,
  type RawProcess,
} from "./platform/processes.js";
export {
  PtyManager,
  cleanEnvironment,
  type SpawnOptions,
  type TerminalInfo,
  type TerminalKind,
  type TerminalState,
} from "./pty/manager.js";
export { OSC_CODE, OscScanner, uriToPath, type ScanResult, type ShellEvent } from "./pty/osc.js";
export {
  installShellProfile,
  profilePath,
  shellProfileScript,
  type ShellProfile,
} from "./pty/shell-profile.js";
export {
  parseClientMessage,
  type ClientMessage,
  type ServerMessage,
} from "./protocol.js";
