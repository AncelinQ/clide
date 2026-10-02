import { describe, expect, it } from "vitest";

import { claudeActivity } from "../src/lib/claude-title";

describe("claudeActivity", () => {
  it("lit le travail dans le glyphe qui tourne", () => {
    expect(claudeActivity("◐ Claude Code")).toBe("working");
    expect(claudeActivity("◑ Revue du front")).toBe("working");
    expect(claudeActivity("⠋ Claude Code")).toBe("working");
  });

  it("lit le repos dans ✳", () => {
    expect(claudeActivity("✳ Claude Code")).toBe("idle");
    expect(claudeActivity("✳ Session test")).toBe("idle");
  });

  it("ne dit rien d'un autre titre", () => {
    expect(claudeActivity("C:\\Program Files\\PowerShell\\7\\pwsh.exe")).toBeUndefined();
    expect(claudeActivity("claude")).toBeUndefined();
    expect(claudeActivity("")).toBeUndefined();
  });
});
