import { describe, expect, it } from "vitest";

import { navigate, testRows, type RowOptions } from "../src/lib/test-tree";
import type { TestSuite } from "../src/lib/types";

const suite: TestSuite = {
  framework: "vitest",
  directory: "C:\\p",
  reportPath: "r.json",
  results: [],
  files: [
    { path: "src/store.test.ts", tests: [{ name: "garde", line: 3, parents: ["store"] }, { name: "vide", line: 8, parents: ["store"] }] },
    { path: "src/calc.test.ts", tests: [{ name: "additionne", line: 4, parents: [] }] },
  ],
};

const options = (patch: Partial<RowOptions> = {}): RowOptions => ({
  folded: new Set(),
  query: "",
  failedOnly: false,
  status: (_suite, _path, test) => (test.name === "vide" ? "failed" : "passed"),
  ...patch,
});

const labels = (rows: ReturnType<typeof testRows>) => rows.map((row) => (row.kind === "test" ? row.test.name : row.kind === "file" ? row.path : "suite"));

describe("testRows", () => {
  it("déroule suite, fichiers et tests, et respecte le repliement", () => {
    expect(labels(testRows([suite], options()))).toEqual(["suite", "src/store.test.ts", "garde", "vide", "src/calc.test.ts", "additionne"]);
    expect(labels(testRows([suite], options({ folded: new Set(["C:\\p|vitest|src/store.test.ts"]) })))).toEqual([
      "suite",
      "src/store.test.ts",
      "src/calc.test.ts",
      "additionne",
    ]);
    expect(labels(testRows([suite], options({ folded: new Set(["C:\\p|vitest"]) })))).toEqual(["suite"]);
  });

  it("filtre par nom complet ou par chemin, en dépliant ce qui répond", () => {
    const folded = new Set(["C:\\p|vitest"]);
    expect(labels(testRows([suite], options({ query: "store garde", folded })))).toEqual(["suite", "src/store.test.ts", "garde"]);
    expect(labels(testRows([suite], options({ query: "calc" })))).toEqual(["suite", "src/calc.test.ts", "additionne"]);
    expect(testRows([suite], options({ query: "introuvable" }))).toEqual([]);
  });

  it("ne garde que les échecs sur demande", () => {
    expect(labels(testRows([suite], options({ failedOnly: true })))).toEqual(["suite", "src/store.test.ts", "vide"]);
  });
});

describe("navigate", () => {
  const rows = testRows([suite], options());
  const key = (label: string) => rows.find((row) => labels([row])[0] === label)?.key;

  it("monte et descend, en partant du haut sans focus", () => {
    expect(navigate(rows, undefined, "ArrowDown", new Set()).focus).toBe(key("suite"));
    expect(navigate(rows, key("garde"), "ArrowDown", new Set()).focus).toBe(key("vide"));
    expect(navigate(rows, key("additionne"), "ArrowDown", new Set()).focus).toBe(key("additionne"));
    expect(navigate(rows, key("garde"), "ArrowUp", new Set()).focus).toBe(key("src/store.test.ts"));
  });

  it("droite déplie ou descend au premier enfant, gauche replie ou remonte au parent", () => {
    const file = key("src/store.test.ts") as string;
    expect(navigate(rows, file, "ArrowRight", new Set([file]))).toEqual({ fold: { key: file, folded: false } });
    expect(navigate(rows, file, "ArrowRight", new Set()).focus).toBe(key("garde"));
    expect(navigate(rows, file, "ArrowLeft", new Set())).toEqual({ fold: { key: file, folded: true } });
    expect(navigate(rows, key("vide"), "ArrowLeft", new Set()).focus).toBe(file);
    expect(navigate(rows, file, "ArrowLeft", new Set([file])).focus).toBe(key("suite"));
  });
});
