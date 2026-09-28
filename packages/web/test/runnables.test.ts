import { describe, expect, it } from "vitest";

import { runnableLines } from "../src/lib/runnables";
import type { TestSuite } from "../src/lib/types";

const brief = (path: string, text: string, manager = "pnpm", suites: TestSuite[] = []) =>
  runnableLines(path, text, { manager, suites }).map((item) => `${item.line}:${item.name}=${item.run}`);

describe("runnableLines", () => {
  it("lit les scripts d'un package.json, pas les autres clés", () => {
    const text = [
      "{",
      '  "name": "web",',
      '  "scripts": {',
      '    "dev": "vite",',
      '    "build": "tsc -b && vite build --define {\\"a\\":1}",',
      '    "test": "vitest run"',
      "  },",
      '  "devDependencies": { "vite": "^7" }',
      "}",
    ].join("\n");
    expect(brief("C:\\p\\web\\package.json", text)).toEqual(["4:dev=pnpm run dev", "5:build=pnpm run build", "6:test=pnpm run test"]);
    expect(runnableLines("C:\\p\\web\\package.json", text, { manager: "npm" })[0]).toMatchObject({ directory: "C:\\p\\web", run: "npm run dev" });
  });

  it("lit les cibles d'un Makefile, sans les cibles spéciales ni les affectations", () => {
    const text = [".PHONY: build", "CC := gcc", "build: deps", "\tgo build", "%.o: %.c", "test:", "VAR ::= x"].join("\n");
    expect(brief("C:\\p\\Makefile", text)).toEqual(["3:build=make build", "6:test=make test"]);
  });

  it("lit les commandes des blocs shell d'un Markdown, invites retirées", () => {
    const text = [
      "# Lancer",
      "```bash",
      "# un commentaire",
      "pnpm install",
      "$ pnpm dev",
      "```",
      "```ts",
      "const a = 1;",
      "```",
      "```console",
      "PS C:\\p> pnpm test",
      "sortie de la commande",
      "```",
    ].join("\n");
    expect(brief("C:\\p\\README.md", text)).toEqual(["4:pnpm install=pnpm install", "5:pnpm dev=pnpm dev", "11:pnpm test=pnpm test"]);
  });

  it("lance un script .ps1 ou .sh entier depuis sa première ligne", () => {
    expect(brief("C:\\p\\scripts\\it's.ps1", "Write-Host 1")).toEqual(["1:it's.ps1=& 'C:\\p\\scripts\\it''s.ps1'"]);
    expect(brief("C:\\p\\deploy.sh", "echo 1")).toEqual(["1:deploy.sh=bash 'C:/p/deploy.sh'"]);
  });

  it("place les tests d'un fichier de test à leur ligne", () => {
    const suite: TestSuite = {
      framework: "vitest",
      directory: "C:\\p\\web",
      files: [{ path: "src/a.test.ts", tests: [{ name: "un", line: 3, parents: ["store"] }] }],
      reportPath: "r.json",
      results: [],
    };
    const [line] = runnableLines("c:/p/web/src/a.test.ts", "", { manager: "pnpm", suites: [suite] });
    expect(line).toMatchObject({ line: 3, name: "store › un", kind: "test", test: { target: { path: "src/a.test.ts", name: "un", parents: ["store"] } } });
    expect(runnableLines("C:\\p\\web\\src\\b.test.ts", "", { manager: "pnpm", suites: [suite] })).toEqual([]);
  });
});
