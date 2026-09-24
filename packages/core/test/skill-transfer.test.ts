import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SkillStore } from "../src/skills/store.js";

let dir: string;
let home: string;
let project: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "clide-skills-"));
  home = join(dir, "home");
  project = join(dir, "app");
  await mkdir(join(project, ".claude", "skills", "relire"), { recursive: true });
  await writeFile(join(project, ".claude", "skills", "relire", "SKILL.md"), "---\nname: relire\n---\n\nCorps.\n", "utf8");
  await writeFile(join(project, ".claude", "skills", "relire", "modele.txt"), "à côté", "utf8");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 3 });
});

describe("copie entre portées", () => {
  it("promeut un skill de projet en skill personnel, fichiers voisins compris", async () => {
    const store = new SkillStore(home);
    const skill = await store.copy({ scope: "project", directory: "relire", projectRoot: project }, { scope: "user" });
    expect(skill).toMatchObject({ name: "relire", scope: "user" });
    expect(await readFile(join(home, "skills", "relire", "modele.txt"), "utf8")).toBe("à côté");
  });

  it("refuse d'écraser un skill existant de l'autre portée", async () => {
    const store = new SkillStore(home);
    await mkdir(join(home, "skills", "relire"), { recursive: true });
    await writeFile(join(home, "skills", "relire", "SKILL.md"), "---\nname: relire\n---\nà moi\n", "utf8");
    await expect(
      store.copy({ scope: "project", directory: "relire", projectRoot: project }, { scope: "user" }),
    ).rejects.toThrow("existe déjà");
    expect(await readFile(join(home, "skills", "relire", "SKILL.md"), "utf8")).toContain("à moi");
  });
});

describe("import", () => {
  it("importe un dossier qui porte un SKILL.md", async () => {
    const source = join(dir, "ailleurs", "deployer");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "SKILL.md"), "---\nname: deployer\n---\n", "utf8");
    const skill = await new SkillStore(home).importPath(source, { scope: "user" });
    expect(skill).toMatchObject({ name: "deployer", directory: "deployer", scope: "user" });
  });

  it("fait d'un .md seul le SKILL.md d'un dossier à son nom, en-tête ajouté s'il manque", async () => {
    const source = join(dir, "notes.md");
    await writeFile(source, "# Consignes\n\nToujours relire.\n", "utf8");
    const skill = await new SkillStore(home).importPath(source, { scope: "project", projectRoot: project });
    expect(skill).toMatchObject({ name: "notes", directory: "notes", scope: "project" });
    const written = await readFile(join(project, ".claude", "skills", "notes", "SKILL.md"), "utf8");
    expect(written.startsWith("---\nname: notes\n---")).toBe(true);
    expect(written).toContain("Toujours relire.");
  });

  it("refuse ce qui n'est ni un .md ni un dossier de skill", async () => {
    const store = new SkillStore(home);
    await writeFile(join(dir, "secret.txt"), "x", "utf8");
    await expect(store.importPath(join(dir, "secret.txt"), { scope: "user" })).rejects.toThrow(".md");
    await mkdir(join(dir, "vide"), { recursive: true });
    await expect(store.importPath(join(dir, "vide"), { scope: "user" })).rejects.toThrow("SKILL.md");
  });
});
