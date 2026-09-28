import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { OutsideWorkspace, WorkspaceRoots, checkRoots, type Expand } from "../src/workspace/roots.js";

describe("WorkspaceRoots", () => {
  let scratch: string;
  let project: string;
  let sibling: string;
  let linked: string;
  let outside: string;

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), "clide-roots-"));
    project = join(scratch, "clide");
    sibling = join(scratch, "clide-docs");
    linked = join(scratch, "api");
    outside = join(scratch, "ailleurs");
    for (const dir of [project, sibling, linked, outside, join(project, "src")]) await mkdir(dir, { recursive: true });
    // Une jonction dans le projet qui mène hors de lui.
    await symlink(outside, join(project, "sortie"), "junction");
  });

  afterAll(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  const withLinks: Expand = async (root) => (root === project ? [linked] : []);

  it("accepte un projet ouvert, ses sous-dossiers et ses dossiers liés", async () => {
    const workspace = new WorkspaceRoots(withLinks);
    await workspace.update([project]);
    expect(await workspace.resolve(project)).toBe(project);
    expect(await workspace.resolve(join(project, "src"))).toBe(join(project, "src"));
    expect(await workspace.resolve(linked)).toBe(linked);
  });

  it("refuse un dossier voisin dont le nom commence pareil", async () => {
    const workspace = new WorkspaceRoots(withLinks);
    await workspace.update([project]);
    await expect(workspace.resolve(sibling)).rejects.toBeInstanceOf(OutsideWorkspace);
  });

  it("refuse ce qui sort du projet par `..` ou par une jonction", async () => {
    const workspace = new WorkspaceRoots(withLinks);
    await workspace.update([project]);
    await expect(workspace.resolve(join(project, "..", "ailleurs"))).rejects.toBeInstanceOf(OutsideWorkspace);
    await expect(workspace.resolve(join(project, "sortie"))).rejects.toBeInstanceOf(OutsideWorkspace);
  });

  it("juge un fichier encore absent sur sa forme écrite", async () => {
    const workspace = new WorkspaceRoots(withLinks);
    await workspace.update([project]);
    const created = join(project, "src", "nouveau.ts");
    expect(await workspace.resolve(created)).toBe(created);
  });

  it("ne garde rien quand aucun projet n'est ouvert", async () => {
    const workspace = new WorkspaceRoots(withLinks);
    await workspace.update([]);
    await expect(workspace.resolve(project)).rejects.toBeInstanceOf(OutsideWorkspace);
  });

  it("retient la dernière liste quand deux mises à jour se croisent", async () => {
    let calls = 0;
    // Le premier calcul finit après le second : il ne doit pas l'écraser.
    const slowFirst: Expand = async () => {
      calls += 1;
      if (calls === 1) await new Promise((done) => setTimeout(done, 50));
      return [];
    };
    const workspace = new WorkspaceRoots(slowFirst);
    void workspace.update([project]);
    await workspace.update([sibling]);
    expect(await workspace.resolve(sibling)).toBe(sibling);
    await expect(workspace.resolve(project)).rejects.toBeInstanceOf(OutsideWorkspace);
  });

  it("voit un dossier lié ajouté après coup, au rafraîchissement", async () => {
    let links: string[] = [];
    const workspace = new WorkspaceRoots(async () => links);
    await workspace.update([project]);
    await expect(workspace.resolve(linked)).rejects.toBeInstanceOf(OutsideWorkspace);
    links = [linked];
    await workspace.refresh();
    expect(await workspace.resolve(linked)).toBe(linked);
  });
});

describe("checkRoots", () => {
  let scratch: string;
  let workspace: WorkspaceRoots;

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), "clide-check-"));
    await mkdir(join(scratch, "ouvert"));
    workspace = new WorkspaceRoots(async () => []);
    await workspace.update([join(scratch, "ouvert")]);
  });

  afterAll(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it("vérifie `root` en paramètre, `root` et `roots` dans le corps", async () => {
    const open = join(scratch, "ouvert");
    const closed = join(scratch, "fermé");
    await expect(checkRoots(workspace, new URLSearchParams({ root: open }))).resolves.toBeUndefined();
    await expect(checkRoots(workspace, new URLSearchParams({ root: closed }))).rejects.toBeInstanceOf(OutsideWorkspace);
    await expect(checkRoots(workspace, new URLSearchParams(), { root: closed })).rejects.toBeInstanceOf(OutsideWorkspace);
    await expect(checkRoots(workspace, new URLSearchParams(), { roots: [open, closed] })).rejects.toBeInstanceOf(
      OutsideWorkspace,
    );
  });

  it("laisse passer une requête qui ne nomme aucun projet", async () => {
    await expect(checkRoots(workspace, new URLSearchParams({ id: "session" }), { scope: "user" })).resolves.toBeUndefined();
  });
});
