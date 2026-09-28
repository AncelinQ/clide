import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listPlans, readPlanFile, withPlanFile } from "../src/session/plan-file.js";

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

describe("listPlans et readPlanFile", () => {
  it("liste les plans du plus récent au plus ancien, titrés par leur premier titre", async () => {
    const old = join(home, "plans", "ancien.md");
    const recent = join(home, "plans", "recent.md");
    await writeFile(old, "# Ancien plan\n- [ ] a\n", "utf8");
    await writeFile(recent, "sans titre\n", "utf8");
    const past = new Date(Date.now() - 3_600_000);
    await utimes(old, past, past);

    const plans = await listPlans(home);
    expect(plans.map((plan) => plan.name)).toEqual(["recent.md", "ancien.md"]);
    expect(plans[1]?.title).toBe("Ancien plan");
    expect(plans[0]?.title).toBeUndefined();
  });

  it("rend une liste vide sans dossier de plans", async () => {
    expect(await listPlans(join(home, "nulle-part"))).toEqual([]);
  });

  it("lit un plan du dossier, et rien en dehors", async () => {
    const path = join(home, "plans", "a.md");
    await writeFile(path, "# Plan\n- [x] fait\n- [ ] reste\n", "utf8");
    const plan = await readPlanFile(path, home);
    expect(plan?.text).toContain("# Plan");
    expect(plan?.progress).toEqual({ done: 1, total: 2 });

    await writeFile(join(home, "ailleurs.md"), "# Non\n", "utf8");
    expect(await readPlanFile(join(home, "ailleurs.md"), home)).toBeUndefined();
    expect(await readPlanFile(join(home, "plans", "absent.md"), home)).toBeUndefined();
  });
});
