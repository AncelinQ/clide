import type { DiagnosticsReport } from "@clide/core";

import type { BrowserFrame, BrowserState } from "./browser/session.js";

import type { ClaudeNotification } from "./notifications/watcher.js";
import type { LiveSession } from "./sessions/live.js";
import type { TerminalInfo, TerminalKind } from "./pty/manager.js";

/** Messages du client vers le serveur, sur la connexion WebSocket. */
export type ClientMessage =
  | {
      t: "open";
      projectRoot: string;
      kind?: TerminalKind;
      cols?: number;
      rows?: number;
      initialCommand?: string;
      /** Projet de l'interface auquel l'onglet appartient. */
      owner?: string;
      /** Nom de l'onglet et script qu'il fait tourner. */
      label?: string;
      script?: string;
    }
  | { t: "input"; id: string; data: string }
  | { t: "resize"; id: string; cols: number; rows: number }
  | { t: "close"; id: string }
  /** La page commence ou cesse de regarder un flux (l'image du navigateur de Claude). */
  | { t: "watch"; topic: WatchTopic; on: boolean };

/** Flux qu'une page peut regarder : le serveur ne les produit que regardés. */
export type WatchTopic = "browser";

/** Messages du serveur vers le client. */
export type ServerMessage =
  /** Terminaux ouverts, avec la fin de leur sortie à rejouer. */
  | { t: "hello"; terminals: TerminalInfo[]; backlogs: Record<string, string> }
  | { t: "opened"; terminal: TerminalInfo }
  | { t: "data"; id: string; data: string }
  | { t: "state"; terminal: TerminalInfo }
  | { t: "exit"; id: string; exitCode: number }
  | { t: "notification"; notification: ClaudeNotification; terminalId?: string }
  | { t: "resume"; terminalId: string }
  | { t: "live"; terminalId: string; session: LiveSession }
  | { t: "error"; message: string }
  /** Erreurs et TODO d'un projet, à chaque vérification terminée. */
  | { t: "diagnostics"; report: DiagnosticsReport }
  /** État du navigateur de Claude : lancé ou non, ses pages, celle montrée. */
  | { t: "browser"; state: BrowserState }
  /** Une image de la page montrée, tant qu'une page la regarde. */
  | { t: "browser.frame"; frame: BrowserFrame };

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
      const owner = str("owner");
      const label = str("label");
      const script = str("script");
      return {
        t: "open",
        projectRoot,
        ...(kind === "shell" || kind === "claude" ? { kind } : {}),
        ...(cols !== undefined ? { cols } : {}),
        ...(rows !== undefined ? { rows } : {}),
        ...(initialCommand ? { initialCommand } : {}),
        ...(owner ? { owner } : {}),
        ...(label ? { label: label.slice(0, 80) } : {}),
        ...(script ? { script: script.slice(0, 1000) } : {}),
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
    case "watch":
      return value["topic"] === "browser" && typeof value["on"] === "boolean" ? { t: "watch", topic: "browser", on: value["on"] } : undefined;
    default:
      return undefined;
  }
}
