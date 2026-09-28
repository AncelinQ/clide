import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildMatcher, filterPaths, globToRegExp, searchFiles, searchText } from "../src/files/search.js";

const at = (text: string, query: string, options = {}) =>
  searchText(text, buildMatcher({ query, ...options })).map((match) => `${match.line}:${match.column}:${match.length}`);

describe("buildMatcher / searchText", () => {
  it("cherche un texte littéral, sans casse par défaut", () => {
    expect(at("a.b A.B\naxb", "a.b")).toEqual(["1:1:3", "1:5:3"]);
    expect(at("a.b A.B", "a.b", { caseSensitive: true })).toEqual(["1:1:3"]);
  });

  it("cherche une expression, et un mot entier, accents compris", () => {
    expect(at("foo1 foo22", "foo\\d+", { regex: true })).toEqual(["1:1:4", "1:6:5"]);
    expect(at("été étés l'été", "été", { wholeWord: true })).toEqual(["1:1:3", "1:12:3"]);
  });

  it("n'avance pas sur place avec une expression qui peut ne rien attraper", () => {
    expect(at("baab", "a*", { regex: true })).toEqual(["1:2:2"]);
  });

  it("refuse une expression invalide", () => {
    expect(() => buildMatcher({ query: "(", regex: true })).toThrow();
  });

  it("recadre une longue ligne autour du résultat", () => {
    const line = `${"x".repeat(300)}cible${"y".repeat(300)}`;
    const [match] = searchText(line, buildMatcher({ query: "cible" }));
    expect(match?.preview.slice(match.previewStart, match.previewStart + 5)).toBe("cible");
    expect(match?.preview.length).toBeLessThan(260);
  });
});

describe("globToRegExp / filterPaths", () => {
  const paths = ["src/a.ts", "src/deep/b.tsx", "docs/guide.md", "README.md", "src/a.test.ts"];

  it("un motif sans / vaut à toute profondeur, un dossier pour son contenu", () => {
    expect(globToRegExp("*.md").test("docs/guide.md")).toBe(true);
    expect(filterPaths(paths, "src")).toEqual(["src/a.ts", "src/deep/b.tsx", "src/a.test.ts"]);
    expect(filterPaths(paths, "src/**/*.tsx, *.md")).toEqual(["src/deep/b.tsx", "docs/guide.md", "README.md"]);
  });

  it("écarte ce que les exclusions désignent", () => {
    expect(filterPaths(paths, "src", "*.test.ts")).toEqual(["src/a.ts", "src/deep/b.tsx"]);
  });
});

describe("searchFiles", () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "clide-search-"));
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "a.ts"), "const cible = 1;\n// cible encore\n");
    await writeFile(join(root, "src", "b.ts"), "rien\n");
    await writeFile(join(root, "logo.png"), Buffer.from([0x89, 0x50, 0x00, 0x63, 0x69, 0x62, 0x6c, 0x65]));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("groupe par fichier et saute les binaires", async () => {
    const result = await searchFiles(root, ["src/a.ts", "src/b.ts", "logo.png"], { query: "cible" });
    expect(result.files.map((file) => `${file.path}:${file.matches.length}`)).toEqual(["src/a.ts:2"]);
    expect(result.truncated).toBe(false);
  });

  it("s'arrête au plafond et le dit", async () => {
    const result = await searchFiles(root, ["src/a.ts"], { query: "cible", maxMatches: 1 });
    expect(result.files[0]?.matches).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });
});
