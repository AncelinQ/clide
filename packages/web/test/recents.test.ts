import { describe, expect, it } from "vitest";

import { recentProjects } from "../src/lib/recents";
import type { SessionSummary } from "../src/lib/types";

const session = (effectiveCwd: string | undefined, lastActivityAt: string): SessionSummary => ({
  sessionId: lastActivityAt,
  projectDir: "x",
  ...(effectiveCwd ? { effectiveCwd } : {}),
  lastActivityAt,
  messageCount: 1,
  fileCount: 0,
  prLinks: [],
});

describe("recentProjects", () => {
  it("compte les sessions par dossier, du plus récent au plus ancien", () => {
    const sessions = [
      session("C:\\p\\a", "2026-01-01"),
      session("C:\\p\\b", "2026-03-01"),
      session("c:\\p\\A\\", "2026-02-01"),
    ];
    expect(recentProjects(sessions, [])).toEqual([
      { root: "C:\\p\\b", sessions: 1, lastActivityAt: "2026-03-01" },
      { root: "C:\\p\\a", sessions: 2, lastActivityAt: "2026-02-01" },
    ]);
  });

  it("écarte les projets ouverts, les dossiers temporaires et les sessions sans dossier", () => {
    const sessions = [
      session("C:\\p\\a", "2026-01-01"),
      session("C:\\Users\\me\\AppData\\Local\\Temp\\x", "2026-01-02"),
      session(undefined, "2026-01-03"),
      session("C:\\p\\c", "2026-01-04"),
    ];
    expect(recentProjects(sessions, ["c:\\p\\c"]).map((item) => item.root)).toEqual(["C:\\p\\a"]);
  });
});
