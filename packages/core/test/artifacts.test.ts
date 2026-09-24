import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { sessionArtifacts } from "../src/session/artifacts.js";

const ID = "0350d6a5-5bec-4df4-ba51-45df51df60f7";
let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "clide-artifacts-"));
  await mkdir(join(home, "projects", "C--Projets-app", ID, "subagents"), { recursive: true });
  await writeFile(join(home, "projects", "C--Projets-app", `${ID}.jsonl`), "{}\n", "utf8");
  await writeFile(join(home, "projects", "C--Projets-app", ID, "subagents", "agent-a.jsonl"), "{}\n", "utf8");
  await mkdir(join(home, "file-history", ID), { recursive: true });
  await writeFile(join(home, "file-history", ID, "abc@v1"), "avant", "utf8");
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 3 });
});

describe("sessionArtifacts", () => {
  it("rassemble ce que la session laisse, et seulement ce qui existe", async () => {
    const artifacts = await sessionArtifacts("C--Projets-app", ID, home);
    expect(artifacts.map((artifact) => artifact.role)).toEqual(["transcript", "subagents", "file-history"]);
    expect(artifacts.find((artifact) => artifact.role === "file-history")?.size).toBe(5);
  });

  it("refuse un identifiant ou un dossier qui pourrait désigner autre chose", async () => {
    await expect(sessionArtifacts("C--Projets-app", "../../settings", home)).rejects.toThrow("identifiant");
    await expect(sessionArtifacts("..", ID, home)).rejects.toThrow("dossier projet");
    await expect(sessionArtifacts(String.raw`C--Projets-app\..\..`, ID, home)).rejects.toThrow("dossier projet");
  });
});
