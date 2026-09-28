import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkName, createEntry, keepBothName, renameEntry, transfer } from "../src/files/operations.js";

describe("keepBothName", () => {
  const taken = (...names: string[]) => (candidate: string) => names.includes(candidate);

  it("garde le nom quand il est libre", () => {
    expect(keepBothName("a.md", taken())).toBe("a.md");
  });

  it("ajoute (2), puis (3), avant l'extension", () => {
    expect(keepBothName("rapport.md", taken("rapport.md"))).toBe("rapport (2).md");
    expect(keepBothName("rapport.md", taken("rapport.md", "rapport (2).md"))).toBe("rapport (3).md");
  });

  it("repart de la base d'un nom qui porte déjà un numéro", () => {
    expect(keepBothName("rapport (2).md", taken("rapport (2).md"))).toBe("rapport (3).md");
  });

  it("traite un fichier caché et un dossier comme un nom sans extension", () => {
    expect(keepBothName(".env", taken(".env"))).toBe(".env (2)");
    expect(keepBothName("src", taken("src"))).toBe("src (2)");
  });
});

describe("checkName", () => {
  it("refuse un nom vide, un chemin ou un caractère interdit", () => {
    for (const name of ["", " ", ".", "..", "a/b", "a\\b", "a:b", "a*b"]) expect(() => checkName(name)).toThrow();
    expect(checkName("  notes.md ")).toBe("notes.md");
  });
});

describe("opérations sur les fichiers", () => {
  let root: string;
  const trashed: string[] = [];
  const trash = async (paths: string[]) => {
    trashed.push(...paths);
    for (const path of paths) await rm(path, { recursive: true, force: true });
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "clide-ops-"));
    trashed.length = 0;
    await mkdir(join(root, "src", "lib"), { recursive: true });
    await mkdir(join(root, "docs"));
    await writeFile(join(root, "src", "a.ts"), "a");
    await writeFile(join(root, "docs", "a.ts"), "ancien");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("crée un fichier vide ou un dossier, jamais par-dessus un existant", async () => {
    expect(await createEntry(root, "notes.md", "file")).toBe(join(root, "notes.md"));
    expect(await readFile(join(root, "notes.md"), "utf8")).toBe("");
    await createEntry(root, "tests", "dir");
    expect((await readdir(root)).sort()).toEqual(["docs", "notes.md", "src", "tests"]);
    await expect(createEntry(root, "src", "dir")).rejects.toThrow(/existe déjà/);
  });

  it("renomme, accepte un changement de casse, refuse un nom pris", async () => {
    expect(await renameEntry(join(root, "src", "a.ts"), "b.ts")).toBe(join(root, "src", "b.ts"));
    expect(await renameEntry(join(root, "src", "b.ts"), "B.ts")).toBe(join(root, "src", "B.ts"));
    await expect(renameEntry(join(root, "src", "B.ts"), "lib")).rejects.toThrow(/existe déjà/);
  });

  it("demande avant d'écraser, sans rien faire", async () => {
    const outcomes = await transfer("copy", [join(root, "src", "a.ts")], join(root, "docs"), { onConflict: "ask", trash });
    expect(outcomes).toEqual([{ source: join(root, "src", "a.ts"), target: join(root, "docs", "a.ts"), status: "skipped", conflict: true }]);
    expect(await readFile(join(root, "docs", "a.ts"), "utf8")).toBe("ancien");
  });

  it("garde les deux en nommant la copie (2)", async () => {
    const [outcome] = await transfer("copy", [join(root, "src", "a.ts")], join(root, "docs"), { onConflict: "keepBoth", trash });
    expect(outcome?.target).toBe(join(root, "docs", "a (2).ts"));
    expect(await readFile(join(root, "docs", "a.ts"), "utf8")).toBe("ancien");
  });

  it("remplace en envoyant d'abord la cible à la corbeille", async () => {
    await transfer("move", [join(root, "src", "a.ts")], join(root, "docs"), { onConflict: "replace", trash });
    expect(trashed).toEqual([join(root, "docs", "a.ts")]);
    expect(await readFile(join(root, "docs", "a.ts"), "utf8")).toBe("a");
    expect(await readdir(join(root, "src"))).toEqual(["lib"]);
  });

  it("copie un dossier entier, et refuse de le mettre dans lui-même", async () => {
    await transfer("copy", [join(root, "src")], join(root, "docs"), { onConflict: "ask", trash });
    expect((await readdir(join(root, "docs", "src"))).sort()).toEqual(["a.ts", "lib"]);
    await expect(transfer("move", [join(root, "src")], join(root, "src", "lib"), { onConflict: "ask", trash })).rejects.toThrow(
      /lui-même/,
    );
  });

  it("ne fait rien d'un déplacement vers le dossier où l'élément se trouve déjà", async () => {
    const [outcome] = await transfer("move", [join(root, "src", "a.ts")], join(root, "src"), { onConflict: "ask", trash });
    expect(outcome?.status).toBe("done");
    expect(await readFile(join(root, "src", "a.ts"), "utf8")).toBe("a");
  });
});
