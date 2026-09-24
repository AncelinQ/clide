import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { RawProcess } from "./processes.js";

const run = promisify(execFile);

export interface ListeningSocket {
  /** Adresse d'écoute telle que `netstat` l'écrit : `127.0.0.1`, `0.0.0.0`, `[::]`, `[::1]`. */
  address: string;
  port: number;
  pid: number;
}

/** Adresses joignables depuis cette machine ; une adresse du réseau seule ne sert pas l'aperçu. */
const LOCAL_BINDS = new Set(["127.0.0.1", "0.0.0.0", "[::]", "[::1]"]);

/**
 * Sockets TCP en écoute, d'après `netstat -ano`.
 *
 * L'état s'écrit dans la langue du système sur certaines versions : un socket en
 * écoute se reconnaît plutôt à son adresse distante vide, `0.0.0.0:0` ou `[::]:0`.
 */
export function parseNetstat(text: string): ListeningSocket[] {
  const out: ListeningSocket[] = [];
  for (const line of text.split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    if (columns[0] !== "TCP" || columns.length < 4) continue;
    const local = /^(.*):(\d+)$/.exec(columns[1] ?? "");
    const remote = columns[2];
    const pid = Number(columns.at(-1));
    if (!local || (remote !== "0.0.0.0:0" && remote !== "[::]:0") || !Number.isInteger(pid) || pid <= 0) continue;
    const address = local[1] ?? "";
    if (!LOCAL_BINDS.has(address)) continue;
    out.push({ address, port: Number(local[2]), pid });
  }
  return out;
}

export async function listListening(): Promise<ListeningSocket[]> {
  if (process.platform !== "win32") return [];
  try {
    const { stdout } = await run("netstat.exe", ["-ano"], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    return parseNetstat(stdout);
  } catch {
    return [];
  }
}

export interface DiscoveredServer {
  url: string;
  port: number;
  pid: number;
  /** Ligne de commande du processus qui écoute, pour le reconnaître. */
  command: string;
  /** Terminal de l'application dont il descend. */
  terminalId: string;
}

/**
 * Un serveur MCP lancé par Claude écoute parfois en HTTP — un tableau de bord,
 * un navigateur piloté —, mais ce n'est pas l'application qu'on développe.
 */
const MCP = /\bmcp\b|[-_]mcp|mcp[-_]/i;

/**
 * Serveurs qui écoutent parmi les descendants des terminaux donnés : ceux qu'on
 * lance à la main, et surtout ceux que Claude lance lui-même en arrière-plan,
 * dont la sortie ne passe jamais par l'onglet.
 *
 * Un port par processus et par numéro : `localhost` résout en IPv4 comme en
 * IPv6, et un serveur qui écoute sur les deux n'en fait qu'un.
 */
export function discoverServers(
  sockets: readonly ListeningSocket[],
  processes: readonly RawProcess[],
  terminals: ReadonlyMap<number, string>,
): DiscoveredServer[] {
  const byPid = new Map(processes.map((process) => [process.pid, process]));
  const terminalOf = (pid: number): string | undefined => {
    const seen = new Set<number>();
    let current = byPid.get(pid);
    while (current && !seen.has(current.pid)) {
      seen.add(current.pid);
      const terminal = terminals.get(current.pid);
      if (terminal) return terminal;
      current = byPid.get(current.parentPid);
    }
    return undefined;
  };

  const found = new Map<number, DiscoveredServer>();
  for (const socket of sockets) {
    if (found.has(socket.port)) continue;
    const terminalId = terminalOf(socket.pid);
    const command = byPid.get(socket.pid)?.commandLine ?? byPid.get(socket.pid)?.name ?? "";
    if (!terminalId || MCP.test(command)) continue;
    found.set(socket.port, { url: `http://localhost:${socket.port}/`, port: socket.port, pid: socket.pid, command, terminalId });
  }
  return [...found.values()].sort((a, b) => a.port - b.port);
}
