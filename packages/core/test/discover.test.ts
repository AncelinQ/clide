import { describe, expect, it } from "vitest";

import { classifyTranscript } from "../src/transcript/discover.js";
import { encodeProjectPath } from "../src/paths.js";

describe("encodeProjectPath", () => {
  it("remplace tout caractère hors alphanumérique par un tiret", () => {
    expect(encodeProjectPath("C:\\Projets")).toBe("C--Projets");
    expect(encodeProjectPath("C:\\Projets\\mon-app")).toBe("C--Projets-mon-app");
    expect(encodeProjectPath("C:\\Projets\\mon-app\\.claude\\worktrees\\wt")).toBe(
      "C--Projets-mon-app--claude-worktrees-wt",
    );
  });
});

describe("classifyTranscript", () => {
  const project = "C--Projets-mon-app";

  it("reconnaît une session à la racine du projet", () => {
    expect(classifyTranscript(project, ["0350d6a5-5bec-4df4-ba51-45df51df60f7.jsonl"])).toEqual({
      projectDir: project,
      kind: "session",
      sessionId: "0350d6a5-5bec-4df4-ba51-45df51df60f7",
    });
  });

  it("rattache un sous-agent à sa session hôte", () => {
    expect(
      classifyTranscript(project, [
        "36655c07-3508-4e8a-a2e0-9d69ece6e61e",
        "subagents",
        "agent-a5214d858afa51b8b.jsonl",
      ]),
    ).toEqual({
      projectDir: project,
      kind: "subagent",
      sessionId: "36655c07-3508-4e8a-a2e0-9d69ece6e61e",
      agentId: "a5214d858afa51b8b",
    });
  });

  it("conserve un transcript rangé autrement plutôt que de le perdre", () => {
    const ref = classifyTranscript(project, ["quelque-chose", "de-nouveau", "ailleurs", "x.jsonl"]);
    expect(ref.kind).toBe("unclassified");
    expect(ref.sessionId).toBe("x");
  });
});
