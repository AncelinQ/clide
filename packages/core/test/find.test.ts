import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fuzzyScore, listProjectFiles, rankFiles } from "../src/files/find.js";

describe("fuzzyScore", () => {
  it("demande les lettres dans l'ordre, espacées ou non", () => {
    expect(fuzzyScore("trmar", "src/components/TerminalArea.tsx")).toBeDefined();
    expect(fuzzyScore("ramt", "src/components/TerminalArea.tsx")).toBeUndefined();
  });

  it("ignore la casse et les espaces de la recherche", () => {
    expect(fuzzyScore("Term Area", "terminalarea.ts")).toBeDefined();
  });

  it("préfère une suite collée dans le nom du fichier à des lettres éparses", () => {
    const name = fuzzyScore("store", "web/src/state/store.ts") as number;
    const scattered = fuzzyScore("store", "src/test/other/review.ts") as number;
    expect(name).toBeGreaterThan(scattered);
  });

  it("préfère un début de mot, y compris en camelCase", () => {
    const camel = fuzzyScore("ta", "TerminalArea.tsx") as number;
    const middle = fuzzyScore("ta", "metadata.ts") as number;
    expect(camel).toBeGreaterThan(middle);
  });
});

describe("rankFiles", () => {
  it("classe du plus pertinent au moins pertinent, et borne le nombre", () => {
    const files = ["docs/pistes.md", "src/state/store.ts", "src/stores/list.ts", "test/store.test.ts"];
    expect(rankFiles(files, "store.ts", 2)).toEqual(["src/state/store.ts", "test/store.test.ts"]);
  });

  it("rend tout, dans l'ordre alphabétique à score égal, pour une recherche vide", () => {
    expect(rankFiles(["b.ts", "a.ts"], "")).toEqual(["a.ts", "b.ts"]);
  });
});

describe("listProjectFiles", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "clide-find-"));
    await mkdir(join(root, "src", "state"), { recursive: true });
    await mkdir(join(root, "node_modules", "paquet"), { recursive: true });
    await mkdir(join(root, ".git"), { recursive: true });
    await writeFile(join(root, "src", "state", "store.ts"), "");
    await writeFile(join(root, ".env"), "");
    await writeFile(join(root, "node_modules", "paquet", "index.js"), "");
    await writeFile(join(root, ".git", "HEAD"), "");
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("liste les fichiers du projet, cachés compris, sans dépendances ni dépôt git", async () => {
    expect((await listProjectFiles(root)).sort()).toEqual([".env", "src/state/store.ts"]);
  });

  it("s'arrête au plafond", async () => {
    expect(await listProjectFiles(root, 1)).toHaveLength(1);
  });
});
