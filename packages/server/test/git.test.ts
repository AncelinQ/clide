import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GitWorktrees, parseWorktreeList } from "../src/platform/git.js";

const run = promisify(execFile);

/** Sortie réelle de `git worktree list --porcelain` sur un dépôt à deux worktrees. */
const PORCELAIN = `worktree C:/Projets/mon-app
HEAD ff7054395f0fc9954d4aa61b8cb3087b0b8ca781
branch refs/heads/aqn/chore/batch

worktree C:/Projets/mon-app/.claude/worktrees/chantier
HEAD 7550305f5b77651929b859fec8e65f497adc70e2
branch refs/heads/aqn/feat/chantier

`;

describe("parseWorktreeList", () => {
  it("lit les blocs et raccourcit les noms de branche", () => {
    const worktrees = parseWorktreeList(PORCELAIN);

    expect(worktrees).toHaveLength(2);
    expect(worktrees[0]).toMatchObject({
      path: "C:/Projets/mon-app",
      branch: "aqn/chore/batch",
      main: true,
    });
    expect(worktrees[1]).toMatchObject({
      path: "C:/Projets/mon-app/.claude/worktrees/chantier",
      branch: "aqn/feat/chantier",
      main: false,
    });
  });

  it("désigne le dépôt principal par sa position, pas par son chemin", () => {
    // Rien dans le chemin ne distingue le dépôt principal d'un worktree ; git le
    // rend toujours en premier, et c'est le seul repère.
    const worktrees = parseWorktreeList(PORCELAIN);
    expect(worktrees.filter((worktree) => worktree.main)).toHaveLength(1);
  });

  it("lit les attributs sans valeur", () => {
    const worktrees = parseWorktreeList("worktree /a\nHEAD abc\ndetached\n\nworktree /b\nbare\n\n");
    expect(worktrees[0]).toMatchObject({ detached: true, bare: false });
    expect(worktrees[1]).toMatchObject({ bare: true, detached: false });
  });

  it("relève ce qui empêche ou appelle un retrait", () => {
    const worktrees = parseWorktreeList(
      "worktree /a\nlocked une raison\n\nworktree /b\nprunable gitdir file points to non-existent location\n\n",
    );
    expect(worktrees[0]?.locked).toBe("une raison");
    expect(worktrees[1]?.prunable).toContain("non-existent");
  });

  it("accepte un dernier bloc sans ligne vide finale", () => {
    expect(parseWorktreeList("worktree /a\nHEAD abc")).toHaveLength(1);
  });

  it("rend une liste vide sur une sortie vide", () => {
    expect(parseWorktreeList("")).toEqual([]);
  });
});

/** Dépôt git réel : c'est le seul moyen de vérifier les refus de suppression. */
describe("GitWorktrees sur un dépôt réel", () => {
  let dir: string;
  let main: string;
  let worktree: string;
  let available = true;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "claude-ide-git-"));
    main = join(dir, "depot");
    worktree = join(main, ".claude", "worktrees", "chantier");
    try {
      await run("git", ["init", "-b", "main", main], { windowsHide: true });
      await run("git", ["config", "user.email", "test@exemple.invalid"], { cwd: main });
      await run("git", ["config", "user.name", "Test"], { cwd: main });
      await writeFile(join(main, "fichier.txt"), "contenu\n", "utf8");
      await run("git", ["add", "."], { cwd: main });
      await run("git", ["commit", "-m", "initial"], { cwd: main, windowsHide: true });
      await run("git", ["worktree", "add", "-b", "chantier", worktree], { cwd: main, windowsHide: true });
    } catch {
      available = false;
    }
  }, 60_000);

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  it("liste le dépôt et son worktree", async () => {
    if (!available) return;
    const worktrees = await new GitWorktrees().list(main);

    expect(worktrees).toHaveLength(2);
    expect(worktrees[0]?.main).toBe(true);
    expect(worktrees[1]?.branch).toBe("chantier");
  }, 30_000);

  it("rapporte l'état de chacun", async () => {
    if (!available) return;
    await writeFile(join(worktree, "brouillon.txt"), "en cours\n", "utf8");
    const details = await new GitWorktrees().details(main);

    const chantier = details.find((item) => item.branch === "chantier");
    expect(chantier?.dirty).toBe(1);
  }, 30_000);

  it("refuse de retirer un worktree qui porte du travail non commité", async () => {
    if (!available) return;
    // `git worktree remove --force` saurait le faire ; ce forçage n'est pas
    // exposé, parce que ce travail-là ne se retrouve nulle part.
    await expect(new GitWorktrees().remove(main, worktree)).rejects.toThrow(/non commité/);
  }, 30_000);

  it("refuse de retirer le dépôt principal", async () => {
    if (!available) return;
    await expect(new GitWorktrees().remove(main, main)).rejects.toThrow(/principal/);
  }, 30_000);

  it("refuse un chemin étranger au dépôt", async () => {
    if (!available) return;
    await expect(new GitWorktrees().remove(main, join(dir, "ailleurs"))).rejects.toThrow(
      /n'appartient pas/,
    );
  }, 30_000);

  it("retire un worktree propre", async () => {
    if (!available) return;
    await rm(join(worktree, "brouillon.txt"), { force: true });
    const { removed } = await new GitWorktrees().remove(main, worktree);

    expect(removed).toBeTruthy();
    expect(await new GitWorktrees().list(main)).toHaveLength(1);
  }, 30_000);

  it("rend une liste vide hors d'un dépôt git", async () => {
    expect(await new GitWorktrees().list(tmpdir())).toEqual([]);
  }, 30_000);
});
