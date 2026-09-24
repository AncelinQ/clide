import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { breadcrumb, listDirectory } from "../src/files/browser.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "clide-browser-"));
  await mkdir(join(root, "src", "pages"), { recursive: true });
  await mkdir(join(root, "node_modules", "paquet"), { recursive: true });
  await mkdir(join(root, ".git"), { recursive: true });
  await writeFile(join(root, "README.md"), "# titre\n", "utf8");
  await writeFile(join(root, "package.json"), "{}", "utf8");
  await writeFile(join(root, "src", "index.ts"), "export {};\n", "utf8");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 3 });
});

describe("listDirectory", () => {
  it("met les dossiers avant les fichiers, chaque groupe trié", async () => {
    const listing = await listDirectory(root);
    // Tri insensible à la casse, comme l'Explorateur : `package.json` avant
    // `README.md`, et non l'inverse comme le ferait un tri par code de caractère.
    expect(listing.entries.map((entry) => entry.name)).toEqual([
      "src",
      "package.json",
      "README.md",
    ]);
    expect(listing.entries[0]?.directory).toBe(true);
  });

  it("cache ce dont le contenu n'intéresse personne ici", async () => {
    const names = (await listDirectory(root)).entries.map((entry) => entry.name);
    expect(names).not.toContain("node_modules");
    expect(names).not.toContain(".git");
  });

  it("écarte les fichiers cachés, et sait les rendre", async () => {
    await writeFile(join(root, ".env.example"), "", "utf8");
    expect((await listDirectory(root)).entries.map((e) => e.name)).not.toContain(".env.example");
    const avec = await listDirectory(root, "", { hidden: true });
    expect(avec.entries.map((e) => e.name)).toContain(".env.example");
    // `node_modules` reste écarté même en montrant les fichiers cachés : ce
    // n'est pas une question de discrétion mais de volume.
    expect(avec.entries.map((e) => e.name)).not.toContain("node_modules");
  });

  it("descend dans un sous-dossier et sait remonter", async () => {
    const listing = await listDirectory(root, "src");
    expect(listing.relativePath).toBe("src");
    expect(listing.parent).toBeDefined();
    expect(listing.entries.map((entry) => entry.name)).toEqual(["pages", "index.ts"]);
  });

  it("n'annonce pas de parent à la racine", async () => {
    expect((await listDirectory(root)).parent).toBeUndefined();
  });

  it("refuse de sortir du projet", async () => {
    // Le chemin vient d'une requête HTTP : un `..` y ramènerait n'importe quel
    // dossier de la machine.
    await expect(listDirectory(root, "..")).rejects.toThrow(/hors du projet/);
    await expect(listDirectory(root, join("src", "..", "..", ".."))).rejects.toThrow(/hors du projet/);
  });

  it("rend la taille d'un fichier et pas celle d'un dossier", async () => {
    const listing = await listDirectory(root);
    const readme = listing.entries.find((entry) => entry.name === "README.md");
    const src = listing.entries.find((entry) => entry.name === "src");
    expect(readme?.size).toBeGreaterThan(0);
    expect(src?.size).toBeUndefined();
  });
});

describe("breadcrumb", () => {
  it("rend le chemin de la racine au dossier courant", async () => {
    const listing = await listDirectory(root, join("src", "pages"));
    const segments = breadcrumb(listing);

    expect(segments.map((segment) => segment.name).slice(1)).toEqual(["src", "pages"]);
    expect(segments[0]?.relativePath).toBe("");
    expect(segments.at(-1)?.relativePath).toBe(join("src", "pages"));
  });

  it("se réduit à la racine quand on y est", async () => {
    expect(breadcrumb(await listDirectory(root))).toHaveLength(1);
  });
});
