import type { TerminalInfo, TerminalKind } from "./pty/manager.js";

/** Messages du client vers le serveur, sur la connexion WebSocket. */
export type ClientMessage =
  | { t: "open"; projectRoot: string; kind?: TerminalKind; cols?: number; rows?: number; initialCommand?: string }
  | { t: "input"; id: string; data: string }
  | { t: "resize"; id: string; cols: number; rows: number }
  | { t: "close"; id: string };

/** Messages du serveur vers le client. */
export type ServerMessage =
  | { t: "hello"; terminals: TerminalInfo[] }
  | { t: "opened"; terminal: TerminalInfo }
  | { t: "data"; id: string; data: string }
  | { t: "state"; terminal: TerminalInfo }
  | { t: "exit"; id: string; exitCode: number }
  | { t: "error"; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Valide un message reçu.
 *
 * Le serveur ouvre des processus : un message mal formé ne doit pas atteindre le
 * gestionnaire de terminaux, et un message inconnu est rejeté plutôt qu'ignoré
 * en silence.
 */
export function parseClientMessage(raw: string): ClientMessage | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(value)) return undefined;

  const str = (key: string): string | undefined =>
    typeof value[key] === "string" ? (value[key] as string) : undefined;
  const num = (key: string): number | undefined =>
    typeof value[key] === "number" && Number.isFinite(value[key]) ? (value[key] as number) : undefined;

  switch (value["t"]) {
    case "open": {
      const projectRoot = str("projectRoot");
      if (!projectRoot) return undefined;
      const kind = value["kind"];
      const cols = num("cols");
      const rows = num("rows");
      const initialCommand = str("initialCommand");
      return {
        t: "open",
        projectRoot,
        ...(kind === "shell" || kind === "claude" ? { kind } : {}),
        ...(cols !== undefined ? { cols } : {}),
        ...(rows !== undefined ? { rows } : {}),
        ...(initialCommand ? { initialCommand } : {}),
      };
    }
    case "input": {
      const id = str("id");
      const data = str("data");
      return id !== undefined && data !== undefined ? { t: "input", id, data } : undefined;
    }
    case "resize": {
      const id = str("id");
      const cols = num("cols");
      const rows = num("rows");
      return id && cols !== undefined && rows !== undefined ? { t: "resize", id, cols, rows } : undefined;
    }
    case "close": {
      const id = str("id");
      return id ? { t: "close", id } : undefined;
    }
    default:
      return undefined;
  }
}
