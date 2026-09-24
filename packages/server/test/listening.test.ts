import { describe, expect, it } from "vitest";

import { discoverServers, parseNetstat } from "../src/platform/listening.js";
import type { RawProcess } from "../src/platform/processes.js";

const NETSTAT = `
Connexions actives

  Proto  Adresse locale         Adresse distante       État
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1688
  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       300
  TCP    127.0.0.1:5173         127.0.0.1:61000        ESTABLISHED     300
  TCP    192.168.1.12:7000      0.0.0.0:0              LISTENING       301
  TCP    [::1]:5173             [::]:0                 ÉCOUTE          300
  TCP    [::]:3000              [::]:0                 LISTENING       302
  UDP    0.0.0.0:5353           *:*                                    900
`;

describe("parseNetstat", () => {
  it("garde les sockets en écoute sur une adresse de la machine, quelle que soit la langue de l'état", () => {
    expect(parseNetstat(NETSTAT)).toEqual([
      { address: "0.0.0.0", port: 135, pid: 1688 },
      { address: "127.0.0.1", port: 5173, pid: 300 },
      { address: "[::1]", port: 5173, pid: 300 },
      { address: "[::]", port: 3000, pid: 302 },
    ]);
  });
});

function proc(pid: number, parentPid: number, commandLine: string): RawProcess {
  return { pid, parentPid, name: "node.exe", commandLine, memoryMB: 1 };
}

describe("discoverServers", () => {
  const processes = [
    proc(10, 1, "pwsh.exe"),
    proc(11, 10, "claude.exe"),
    proc(12, 11, "bash -c pnpm dev"),
    proc(300, 12, "node vite"),
    proc(302, 11, "node serena-mcp-server --port 3000"),
    proc(1688, 4, "svchost.exe"),
  ];
  const sockets = parseNetstat(NETSTAT);

  it("rattache à son terminal un serveur que Claude a lancé, une fois par port", () => {
    expect(discoverServers(sockets, processes, new Map([[10, "tab-1"]]))).toEqual([
      { url: "http://localhost:5173/", port: 5173, pid: 300, command: "node vite", terminalId: "tab-1" },
    ]);
  });

  it("ignore ce qui ne descend d'aucun terminal de l'application, et les serveurs MCP", () => {
    expect(discoverServers(sockets, processes, new Map([[99, "tab-2"]]))).toEqual([]);
  });
});
