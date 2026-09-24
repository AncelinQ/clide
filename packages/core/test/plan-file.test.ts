import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { withPlanFile } from "../src/session/plan-file.js";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "clide-plan-"));
  await mkdir(join(home, "plans"), { recursive: true });
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 3 });
});

describe("withPlanFile", () => {
  it("lit le plan rédigé quand aucun n'a été soumis", async () => {
    const path = join(home, "plans", "a.md");
    await writeFile(path, "# Plan\n- [x] lire\n- [ ] écrire\n", "utf8");
    const lookup = await withPlanFile({ planModeEntries: 1, planFilePath: path }, home);
    expect(lookup.plan?.text).toContain("# Plan");
    expect(lookup.plan?.progress).toEqual({ done: 1, total: 2 });
  });

  it("garde le plan soumis s'il est plus récent que le fichier", async () => {
    const path = join(home, "plans", "a.md");
    await writeFile(path, "brouillon", "utf8");
    await utimes(path, new Date("2026-09-01T10:00:00Z"), new Date("2026-09-01T10:00:00Z"));
    const lookup = await withPlanFile(
      { planModeEntries: 1, planFilePath: path, plan: { text: "soumis", at: "2026-09-01T11:00:00Z" } },
      home,
    );
    expect(lookup.plan?.text).toBe("soumis");
  });

  it("ne lit rien hors de ~/.claude/plans", async () => {
    const outside = join(home, "secret.md");
    await writeFile(outside, "à ne pas lire", "utf8");
    const lookup = await withPlanFile({ planModeEntries: 1, planFilePath: outside }, home);
    expect(lookup.plan).toBeUndefined();
  });

  it("s'accommode d'un fichier annoncé mais pas encore écrit", async () => {
    const lookup = await withPlanFile({ planModeEntries: 1, planFilePath: join(home, "plans", "absent.md") }, home);
    expect(lookup.plan).toBeUndefined();
  });
});
