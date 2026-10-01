import { describe, expect, it } from "vitest";

import { isTerminalReply } from "../src/lib/terminal-input";

describe("isTerminalReply", () => {
  it("reconnaît les réponses de xterm au programme", () => {
    expect(isTerminalReply("\u001b[12;40R")).toBe(true);
    expect(isTerminalReply("\u001b[?1;2c")).toBe(true);
    expect(isTerminalReply("\u001b[>0;276;0c")).toBe(true);
    expect(isTerminalReply("\u001b[I")).toBe(true);
    expect(isTerminalReply("\u001b[O")).toBe(true);
    expect(isTerminalReply("\u001b]11;rgb:1e1e/1e1e/1e1e\u0007")).toBe(true);
    expect(isTerminalReply("\u001b]10;rgb:ffff/ffff/ffff\u001b\\")).toBe(true);
  });

  it("tient le reste pour une frappe", () => {
    expect(isTerminalReply("claude\r")).toBe(false);
    expect(isTerminalReply("\r")).toBe(false);
    expect(isTerminalReply("\u0003")).toBe(false);
    expect(isTerminalReply("\u001b[A")).toBe(false);
    expect(isTerminalReply("\u001b")).toBe(false);
    expect(isTerminalReply("\u001b[200~npm i\u001b[201~")).toBe(false);
  });
});
