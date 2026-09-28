import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DiagnosticsReport } from "@clide/core";

import { CheckQueue, checkProject } from "../src/modules/diagnostics.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("CheckQueue", () => {
  it("regroupe les demandes rapprochées en une vérification", async () => {
    const checked: string[] = [];
    const queue = new CheckQueue(async (root) => {
      checked.push(root);
      return { root, tools: [] };
    }, undefined, 30);
    queue.schedule("A");
    queue.schedule("A");
    queue.schedule("A");
    await queue.idle();
    expect(checked).toEqual(["A"]);
  });

  it("ne relance qu'une fois ce qui est demandé pendant une vérification", async () => {
    const checked: string[] = [];
    let release: () => void = () => undefined;
    const queue = new CheckQueue(
      async (root) => {
        checked.push(root);
        if (checked.length === 1) await new Promise<void>((done) => (release = done));
        return { root, tools: [] };
      },
      undefined,
      10,
    );
    queue.schedule("A");
    await new Promise((done) => setTimeout(done, 40));
    queue.schedule("A");
    await new Promise((done) => setTimeout(done, 40));
    queue.schedule("A");
    await new Promise((done) => setTimeout(done, 40));
    release();
    await queue.idle();
    expect(checked).toEqual(["A", "A"]);
  });

  it("vérifie au plus deux projets à la fois, et garde le dernier rapport de chacun", async () => {
    let running = 0;
    let peak = 0;
    const reports: DiagnosticsReport[] = [];
    const queue = new CheckQueue(
      async (root) => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((done) => setTimeout(done, 30));
        running -= 1;
        return { root, tools: [] };
      },
      (report) => reports.push(report),
      5,
      2,
    );
    for (const root of ["A", "B", "C", "D"]) queue.schedule(root);
    await queue.idle();
    expect(peak).toBe(2);
    expect(reports.map((report) => report.root).sort()).toEqual(["A", "B", "C", "D"]);
    expect(queue.report("C")).toEqual({ root: "C", tools: [] });
  });
});

describe("checkProject", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "clide-diag-"));
    await mkdir(join(root, "src"));
    await mkdir(join(root, "node_modules"));
    // Le typescript du dépôt, relié plutôt qu'installé : le test ne télécharge rien.
    await symlink(join(REPO, "node_modules", "typescript"), join(root, "node_modules", "typescript"), "junction");
    await writeFile(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ["src"] }));
    await writeFile(join(root, "src", "a.ts"), "const n: number = 'texte';\n// TODO: typer correctement\n");
    await writeFile(join(root, "README.md"), "# Projet\n\n- FIXME: écrire le guide\n");
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("rend les erreurs du tsc du projet et ses TODO, sans ESLint absent", async () => {
    const report = await checkProject(root);
    expect(report.tools.map((tool) => tool.tool).sort()).toEqual(["todo", "tsc"]);
    const tsc = report.tools.find((tool) => tool.tool === "tsc");
    expect(tsc?.diagnostics).toEqual([
      expect.objectContaining({ path: join(root, "src", "a.ts"), line: 1, code: "TS2322", severity: "error" }),
    ]);
    const todos = report.tools.find((tool) => tool.tool === "todo")?.diagnostics.map((todo) => `${todo.code}:${todo.message}`);
    expect(todos?.sort()).toEqual(["FIXME:écrire le guide", "TODO:typer correctement"]);
  }, 60_000);
});
