import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApiContext } from "../src/api/routes.js";
import { tests } from "../src/modules/tests.js";
import { WorkspaceRoots } from "../src/workspace/roots.js";

describe("module tests", () => {
  let dir: string;
  let project: string;
  let context: ApiContext;
  const route = (path: string) => tests.routes?.[path] as (params: URLSearchParams, context: ApiContext) => Promise<unknown>;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "clide-tests-srv-"));
    project = join(dir, "web");
    await mkdir(join(project, "src"), { recursive: true });
    await writeFile(join(project, "package.json"), JSON.stringify({ devDependencies: { vitest: "^2" } }));
    await writeFile(join(project, "src", "a.test.ts"), 'describe("store", () => {\n  it("un", () => {});\n  it("deux", () => {});\n});\n');
    const workspace = new WorkspaceRoots(async () => []);
    await workspace.update([project]);
    context = { dataDir: join(dir, "data"), workspace } as unknown as ApiContext;
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("détecte la suite, ses tests, et le rapport à écrire dans les données de Clide", async () => {
    const { suites } = (await route("/api/tests")(new URLSearchParams({ root: project }), context)) as {
      suites: { framework: string; files: { path: string; tests: { name: string }[] }[]; reportPath: string; results: unknown[] }[];
    };
    expect(suites).toHaveLength(1);
    expect(suites[0]?.framework).toBe("vitest");
    expect(suites[0]?.files[0]?.tests.map((test) => test.name)).toEqual(["un", "deux"]);
    expect(suites[0]?.reportPath.startsWith(join(dir, "data", "tests"))).toBe(true);
    expect(suites[0]?.results).toEqual([]);
  });

  it("relit le rapport du dernier lancement, et garde les résultats d'un lancement partiel", async () => {
    const { suites } = (await route("/api/tests")(new URLSearchParams({ root: project }), context)) as { suites: { reportPath: string }[] };
    const report = suites[0]?.reportPath as string;
    await mkdir(dirname(report), { recursive: true });
    // Vitest écrit le chemin réel, même quand le dossier est connu par son nom court Windows.
    const real = realpathSync.native(project);
    const write = (results: { title: string; status: string }[]) =>
      writeFile(report, JSON.stringify({ testResults: [{ name: join(real, "src", "a.test.ts"), assertionResults: results.map((result) => ({ ...result, ancestorTitles: ["store"] })) }] }));
    const read = async () =>
      ((await route("/api/tests/results")(new URLSearchParams({ directory: project, framework: "vitest", since: String(Date.now() - 5000) }), context)) as {
        results: { name: string; status: string }[];
      }).results;

    await write([{ title: "un", status: "failed" }, { title: "deux", status: "passed" }]);
    expect((await read()).map((result) => `${result.name}:${result.status}`).sort()).toEqual(["deux:passed", "un:failed"]);

    // On relance seulement « un » : « deux » garde son dernier résultat.
    await write([{ title: "un", status: "passed" }]);
    expect((await read()).map((result) => `${result.name}:${result.status}`).sort()).toEqual(["deux:passed", "un:passed"]);
  });
});
