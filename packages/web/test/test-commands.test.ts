import { describe, expect, it } from "vitest";

import { buildTestCommand } from "../src/lib/test-commands";

const REPORT = "C:\\data\\tests\\ab-vitest.json";

describe("buildTestCommand", () => {
  it("lance toute une suite Vitest avec son rapport JSON", () => {
    expect(buildTestCommand("vitest", REPORT)).toBe(
      "npx --no-install vitest run --reporter=default --reporter=json --outputFile='C:\\data\\tests\\ab-vitest.json'",
    );
  });

  it("filtre un test par son nom complet, échappé et ancré", () => {
    expect(buildTestCommand("jest", "r.json", { path: "src/a.test.ts", name: "garde l'état (1)", parents: ["store"] })).toBe(
      "npx --no-install jest --json --outputFile='r.json' 'src/a.test.ts' -t '^store garde l''état \\(1\\)$'",
    );
  });

  it("désigne un test pytest par son identifiant", () => {
    expect(buildTestCommand("pytest", "r.xml", { path: "tests/test_x.py", name: "test_ajout", parents: ["TestPanier"] })).toBe(
      "python -m pytest --junitxml='r.xml' 'tests/test_x.py::TestPanier::test_ajout'",
    );
    expect(buildTestCommand("pytest", "r.xml", { path: "tests/test_x.py" })).toBe("python -m pytest --junitxml='r.xml' 'tests/test_x.py'");
  });
});
