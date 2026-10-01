import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { claudeLaunch } from "../src/sessions/launch.js";

let home: string;
let project: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "clide-launch-"));
  project = join(home, "projet");
  await mkdir(join(project, ".claude"), { recursive: true });
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 3 });
});

const settings = (file: string, value: Record<string, unknown>) => writeFile(file, JSON.stringify(value), "utf8");

describe("claudeLaunch", () => {
  it("prend le modèle et l'effort des réglages utilisateur", async () => {
    await settings(join(home, "settings.json"), { model: "claude-opus-5-5", effortLevel: "high" });
    expect(await claudeLaunch("claude", project, home)).toEqual({ model: "claude-opus-5-5", effort: "high" });
  });

  it("préfère l'effort réglé pour le modèle à l'effort général", async () => {
    await settings(join(home, "settings.json"), {
      model: "claude-opus-5-5",
      effortLevel: "high",
      modelSettings: { "claude-opus-5-5": { effortLevel: "xhigh" }, "claude-fable-5-1": { effortLevel: "low" } },
    });
    expect(await claudeLaunch("claude", project, home)).toEqual({ model: "claude-opus-5-5", effort: "xhigh" });
    expect(await claudeLaunch("claude --model claude-fable-5-1", project, home)).toEqual({
      model: "claude-fable-5-1",
      effort: "low",
    });
  });

  it("fait primer la ligne de commande, puis le projet, sur l'utilisateur", async () => {
    await settings(join(home, "settings.json"), { model: "claude-opus-5-5", effortLevel: "high" });
    await settings(join(project, ".claude", "settings.json"), { model: "claude-sonnet-5-5" });
    await settings(join(project, ".claude", "settings.local.json"), { effortLevel: "low" });
    expect(await claudeLaunch("claude", project, home)).toEqual({ model: "claude-sonnet-5-5", effort: "low" });
    expect(await claudeLaunch("claude --model=claude-fable-5-1 --effort max", project, home)).toEqual({
      model: "claude-fable-5-1",
      effort: "max",
    });
  });

  it("ne dit rien sans réglage, et ignore un fichier illisible", async () => {
    await writeFile(join(home, "settings.json"), "{ pas du json", "utf8");
    expect(await claudeLaunch("claude", project, home)).toEqual({});
  });
});
