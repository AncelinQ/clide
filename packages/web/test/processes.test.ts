import { describe, expect, it } from "vitest";

import { isClaudeProcess, tabOf } from "../src/lib/processes";
import type { ProcessNode } from "../src/lib/types";

const node = (patch: Partial<ProcessNode>): ProcessNode => ({ pid: 1, name: "x", memoryMB: 1, link: { kind: "orphan" }, children: [], ...patch });

describe("processus", () => {
  it("hérite de l'onglet de ses parents, sauf à en être la racine", () => {
    expect(tabOf(node({ link: { kind: "owned", terminalId: "t1" } }), undefined)).toBe("t1");
    expect(tabOf(node({}), "t1")).toBe("t1");
    expect(tabOf(node({ link: { kind: "inferred", confidence: 0.8 } }), undefined)).toBeUndefined();
  });

  it("reconnaît Claude Code, natif ou par Node", () => {
    expect(isClaudeProcess(node({ name: "claude.exe" }))).toBe(true);
    expect(isClaudeProcess(node({ name: "node.exe", commandLine: "node C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js" }))).toBe(true);
    expect(isClaudeProcess(node({ name: "node.exe", commandLine: "node vite.js" }))).toBe(false);
    // Un dossier nommé claude sur le chemin n'en fait pas Claude Code.
    expect(isClaudeProcess(node({ name: "node.exe", commandLine: "node C:\\Temp\\claude\\projet\\serveur.js" }))).toBe(false);
    expect(isClaudeProcess(node({ name: "node.exe", commandLine: "node C:\\bin\\claude --resume" }))).toBe(true);
    expect(isClaudeProcess(node({ name: "pwsh.exe" }))).toBe(false);
  });
});
