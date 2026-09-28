import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { detectTests, mergeResults, parseJsonReport, parseJunit, parseTestNames } from "../src/tests/tests.js";

describe("parseTestNames", () => {
  it("lit describe / it / test imbriqués, avec only, skip et each", () => {
    const text = [
      'describe("store", () => {',
      '  it("garde l\'état", () => {});',
      "  describe.only('projets', () => {",
      "    test.each([1, 2])(`ouvre %s`, () => {});",
      '    it.skip("ferme", () => {});',
      "  });",
      '  test("après le bloc", () => {});',
      "});",
      'it("à la racine", () => {});',
    ].join("\n");
    expect(parseTestNames(text, "vitest")).toEqual([
      { name: "garde l'état", line: 2, parents: ["store"] },
      { name: "ouvre %s", line: 4, parents: ["store", "projets"] },
      { name: "ferme", line: 5, parents: ["store", "projets"] },
      { name: "après le bloc", line: 7, parents: ["store"] },
      { name: "à la racine", line: 9, parents: [] },
    ]);
  });

  it("lit les fonctions et les classes de pytest", () => {
    const text = ["def test_seul():", "    pass", "", "class TestPanier:", "    def test_ajout(self):", "        pass", "    async def test_vide(self):", "        pass"].join("\n");
    expect(parseTestNames(text, "pytest")).toEqual([
      { name: "test_seul", line: 1, parents: [] },
      { name: "test_ajout", line: 5, parents: ["TestPanier"] },
      { name: "test_vide", line: 7, parents: ["TestPanier"] },
    ]);
  });
});

describe("detectTests", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "clide-tests-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("reconnaît Vitest par la dépendance, et pytest par pyproject.toml", async () => {
    await writeFile(join(root, "package.json"), JSON.stringify({ devDependencies: { vitest: "^2" } }));
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "a.test.ts"), 'it("un", () => {});');
    await writeFile(join(root, "src", "a.ts"), "");
    await writeFile(join(root, "pyproject.toml"), "");
    await mkdir(join(root, "tests"));
    await writeFile(join(root, "tests", "test_x.py"), "def test_a():\n    pass\n");
    const suites = await detectTests(root);
    expect(suites.map((suite) => `${suite.framework}:${suite.files.map((file) => file.path).join(",")}`)).toEqual([
      "vitest:src/a.test.ts",
      "pytest:tests/test_x.py",
    ]);
  });

  it("ne rend rien sans outil ni fichier de test", async () => {
    await writeFile(join(root, "package.json"), JSON.stringify({ devDependencies: { jest: "^29" } }));
    expect(await detectTests(root)).toEqual([]);
  });
});

describe("rapports", () => {
  it("lit le JSON de Vitest et de Jest, chemins relatifs à la suite", () => {
    const report = JSON.stringify({
      testResults: [
        {
          name: "C:\\p\\web\\src\\a.test.ts",
          assertionResults: [
            { title: "un", ancestorTitles: ["store"], status: "passed", duration: 3.4 },
            { title: "deux", ancestorTitles: [], status: "failed", failureMessages: ["expected 1 to be 2"] },
            { title: "trois", status: "pending" },
          ],
        },
      ],
    });
    expect(parseJsonReport(report, "C:\\p\\web")).toEqual([
      { path: "src/a.test.ts", name: "un", parents: ["store"], status: "passed", durationMs: 3 },
      { path: "src/a.test.ts", name: "deux", parents: [], status: "failed", failure: "expected 1 to be 2" },
      { path: "src/a.test.ts", name: "trois", parents: [], status: "skipped" },
    ]);
  });

  it("lit le JUnit de pytest, échecs, sauts et classes", () => {
    const xml = [
      '<testsuite><testcase classname="tests.test_x" name="test_a" time="0.01"/>',
      '<testcase classname="tests.test_x.TestPanier" name="test_ajout" file="tests/test_x.py" time="0.2">',
      '<failure message="assert 1 == 2">détail &amp; pile</failure></testcase>',
      '<testcase classname="tests.test_x" name="test_c"><skipped/></testcase></testsuite>',
    ].join("");
    expect(parseJunit(xml)).toEqual([
      { path: "tests/test_x.py", name: "test_a", parents: [], status: "passed", durationMs: 10 },
      { path: "tests/test_x.py", name: "test_ajout", parents: ["TestPanier"], status: "failed", durationMs: 200, failure: "assert 1 == 2\ndétail & pile" },
      { path: "tests/test_x.py", name: "test_c", parents: [], status: "skipped" },
    ]);
  });

  it("garde le dernier résultat d'un test absent du nouveau rapport", () => {
    const known = [
      { path: "a.test.ts", name: "un", parents: [], status: "failed" as const },
      { path: "b.test.ts", name: "deux", parents: [], status: "passed" as const },
    ];
    const merged = mergeResults(known, [{ path: "a.test.ts", name: "un", parents: [], status: "passed" }]);
    expect(merged.map((result) => `${result.path}:${result.status}`).sort()).toEqual(["a.test.ts:passed", "b.test.ts:passed"]);
  });

  it("ne prend pas pour un saut le filtre d'un test lancé seul", () => {
    const known = [
      { path: "a.test.ts", name: "un", parents: [], status: "failed" as const },
      { path: "a.test.ts", name: "deux", parents: [], status: "failed" as const },
    ];
    const fresh = [
      { path: "a.test.ts", name: "un", parents: [], status: "skipped" as const },
      { path: "a.test.ts", name: "deux", parents: [], status: "passed" as const },
    ];
    const merged = mergeResults(known, fresh, "a.test.ts › deux");
    expect(merged.map((result) => `${result.name}:${result.status}`).sort()).toEqual(["deux:passed", "un:failed"]);
  });
});
