import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LinkStore } from "@clide/core";

import {
  DirtyTreeError,
  createBranch,
  createWorktree,
  excludeClideFiles,
  gitPull,
  gitPush,
  gitStatus,
  listBranches,
  pullMany,
  parseBranches,
  parseStatusV2,
  pushPlan,
  stashCount,
  stashPop,
  switchBranch,
  worktreeFolder,
} from "../src/platform/git-actions.js";

const run = promisify(execFile);
const git = (cwd: string, ...args: string[]) => run("git", args, { cwd, windowsHide: true });

describe("parseStatusV2", () => {
  it("repère un amont disparu : nommé, mais sans écart", () => {
    const gone = parseStatusV2(["# branch.oid 1234567890", "# branch.head aqn/feat/x", "# branch.upstream origin/aqn/feat/x"].join("\n"));
    expect(gone.upstreamGone).toBe(true);
    const alive = parseStatusV2(
      ["# branch.oid 1234567890", "# branch.head main", "# branch.upstream origin/main", "# branch.ab +0 -0"].join("\n"),
    );
    expect(alive.upstreamGone).toBeUndefined();
  });

  it("lit la branche, l'amont, l'écart et les fichiers touchés", () => {
    const status = parseStatusV2(
      [
        "# branch.oid 1234567890abcdef",
        "# branch.head aqn/feat/x",
        "# branch.upstream origin/aqn/feat/x",
        "# branch.ab +2 -1",
        "1 .M N... 100644 100644 100644 aaa bbb src/a.ts",
        "? nouveau.ts",
        "u UU N... 100644 100644 100644 100644 aaa bbb ccc conflit.ts",
      ].join("\n"),
    );
    expect(status).toEqual({
      head: "12345678",
      branch: "aqn/feat/x",
      upstream: "origin/aqn/feat/x",
      ahead: 2,
      behind: 1,
      changed: 1,
      untracked: 1,
      conflicted: 1,
    });
  });

  it("reconnaît un HEAD détaché et un dépôt sans commit", () => {
    expect(parseStatusV2("# branch.oid (initial)\n# branch.head (detached)\n")).toEqual({
      ahead: 0,
      behind: 0,
      changed: 0,
      untracked: 0,
      conflicted: 0,
    });
  });
});

describe("parseBranches", () => {
  it("met les branches locales d'abord, puis celles qui ne sont que distantes, sans l'alias HEAD", () => {
    const refs = [
      "refs/heads/main\t2026-09-20T10:00:00+02:00",
      "refs/heads/aqn/feat/x\t2026-09-24T10:00:00+02:00",
      "refs/remotes/origin/HEAD\t2026-09-20T10:00:00+02:00",
      "refs/remotes/origin/main\t2026-09-20T10:00:00+02:00",
      "refs/remotes/origin/collegue/y\t2026-09-23T10:00:00+02:00",
    ].join("\n");
    expect(parseBranches(refs, "main").map((branch) => [branch.name, branch.remoteOnly, branch.current])).toEqual([
      ["aqn/feat/x", false, false],
      ["main", false, true],
      ["collegue/y", true, false],
    ]);
  });
});

describe("worktreeFolder", () => {
  it("fait un nom de dossier d'un nom de branche", () => {
    expect(worktreeFolder("aqn/feat/hn-12 x")).toBe("aqn-feat-hn-12-x");
  });
});

/** Un dépôt « distant » nu et deux clones : le nôtre, et un collègue qui pousse aussi. */
describe("fetch, pull et push sur de vrais dépôts", () => {
  let scratch: string;
  let remote: string;
  let mine: string;
  let theirs: string;

  const commit = async (cwd: string, file: string, text: string) => {
    await writeFile(join(cwd, file), text);
    await git(cwd, "add", file);
    await git(cwd, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", `ajoute ${file}`);
  };

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), "clide-git-"));
    remote = join(scratch, "remote.git");
    mine = join(scratch, "mine");
    theirs = join(scratch, "theirs");
    await git(scratch, "init", "--bare", "-b", "main", remote);
    await git(scratch, "clone", remote, mine);
    await git(mine, "checkout", "-b", "main");
    await commit(mine, "a.txt", "a");
    await git(mine, "push", "-u", "origin", "main");
    await git(scratch, "clone", remote, theirs);
  }, 60_000);

  afterAll(async () => {
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  it("montre les commits qu'un push enverrait, puis les envoie", async () => {
    await commit(mine, "b.txt", "b");
    const plan = await pushPlan(mine);
    expect(plan).toMatchObject({ branch: "main", remote: "origin", target: "main", setUpstream: false });
    expect(plan.commits.map((entry) => entry.subject)).toEqual(["ajoute b.txt"]);
    await gitPush(mine, plan.head);
    expect((await gitStatus(mine))?.ahead).toBe(0);
  }, 30_000);

  it("crée l'amont d'une branche neuve", async () => {
    await git(mine, "checkout", "-b", "aqn/feat/neuve");
    await commit(mine, "c.txt", "c");
    const plan = await pushPlan(mine);
    expect(plan).toMatchObject({ setUpstream: true, target: "aqn/feat/neuve" });
    expect(plan.commits.map((entry) => entry.subject)).toEqual(["ajoute c.txt"]);
    await gitPush(mine, plan.head);
    expect((await gitStatus(mine))?.upstream).toBe("origin/aqn/feat/neuve");
    await git(mine, "checkout", "main");
  }, 30_000);

  it("refuse un push dont HEAD a bougé depuis l'aperçu", async () => {
    await commit(mine, "d.txt", "d");
    const plan = await pushPlan(mine);
    await commit(mine, "e.txt", "e");
    await expect(gitPush(mine, plan.head)).rejects.toThrow("a changé depuis l'aperçu");
    await gitPush(mine, (await pushPlan(mine)).head);
  }, 30_000);

  it("refuse de pousser une branche en retard, et tire en avance rapide", async () => {
    await git(theirs, "pull");
    await commit(theirs, "f.txt", "f");
    await git(theirs, "push");
    await git(mine, "fetch");
    const plan = await pushPlan(mine);
    expect(plan.blocked).toContain("retard");
    await gitPull(mine);
    expect(await gitStatus(mine)).toMatchObject({ ahead: 0, behind: 0 });
  }, 30_000);

  it("rend compte d'un pull groupé, dépôt par dépôt, sans tirer deux fois le même", async () => {
    await commit(theirs, "groupe-1.txt", "1");
    await commit(theirs, "groupe-2.txt", "2");
    await git(theirs, "push");

    const first = await pullMany([mine, `${mine}\\`, scratch]);
    expect(first).toEqual([
      { root: mine, outcome: "updated", branch: "main", commits: 2 },
      { root: scratch, outcome: "skipped", reason: "not-a-repo" },
    ]);
    expect(await pullMany([mine])).toEqual([{ root: mine, outcome: "up-to-date", branch: "main" }]);
  }, 30_000);

  it("ne force qu'une branche divergée, et seulement contre le commit distant de l'aperçu", async () => {
    await commit(theirs, "divergence-distant.txt", "d");
    await git(theirs, "push");
    await commit(mine, "divergence-local.txt", "l");
    await git(mine, "fetch");

    const plan = await pushPlan(mine);
    expect(plan.diverged).toBe(true);
    expect(plan.blocked).toContain("divergé");
    expect(plan.overwritten.map((entry) => entry.subject)).toEqual(["ajoute divergence-distant.txt"]);
    await expect(gitPush(mine, plan.head)).rejects.toThrow("divergé");

    // Quelqu'un pousse après l'aperçu : le bail tombe, rien n'est écrasé.
    await commit(theirs, "divergence-encore.txt", "e");
    await git(theirs, "push");
    await expect(gitPush(mine, plan.head, { remoteHead: plan.remoteHead! })).rejects.toThrow();

    await git(mine, "fetch");
    const fresh = await pushPlan(mine);
    expect(fresh.overwritten).toHaveLength(2);
    await gitPush(mine, fresh.head, { remoteHead: fresh.remoteHead! });
    await git(theirs, "fetch");
    const { stdout } = await git(theirs, "rev-parse", "origin/main");
    expect(stdout.trim()).toBe(fresh.head);
    await git(theirs, "reset", "--hard", "origin/main");
  }, 30_000);

  it("refuse de forcer une branche qui n'est qu'en retard", async () => {
    await commit(theirs, "retard.txt", "r");
    await git(theirs, "push");
    await git(mine, "fetch");
    const plan = await pushPlan(mine);
    expect(plan.diverged).toBe(false);
    await expect(gitPush(mine, plan.head, { remoteHead: plan.remoteHead! })).rejects.toThrow("retard");
    await gitPull(mine);
  }, 30_000);

  it("refuse de changer de branche avec des modifications, puis les met de côté si on le demande", async () => {
    await writeFile(join(mine, "a.txt"), "modifié");
    await expect(switchBranch(mine, "aqn/feat/neuve")).rejects.toBeInstanceOf(DirtyTreeError);
    expect((await gitStatus(mine))?.branch).toBe("main");

    expect(await switchBranch(mine, "aqn/feat/neuve", { stash: true })).toEqual({ stashed: true });
    expect(await gitStatus(mine)).toMatchObject({ branch: "aqn/feat/neuve", changed: 0 });
    expect(await stashCount(mine)).toBe(1);

    await switchBranch(mine, "main");
    await stashPop(mine);
    expect(await readFile(join(mine, "a.txt"), "utf8")).toBe("modifié");
    expect(await stashCount(mine)).toBe(0);
    await git(mine, "checkout", "--", "a.txt");
  }, 30_000);

  it("passe sur une branche qui n'existe que sur le dépôt distant", async () => {
    await git(theirs, "checkout", "-b", "collegue/y");
    await commit(theirs, "y.txt", "y");
    await git(theirs, "push", "-u", "origin", "collegue/y");
    await git(mine, "fetch");
    expect((await listBranches(mine)).find((branch) => branch.name === "collegue/y")?.remoteOnly).toBe(true);
    await switchBranch(mine, "collegue/y");
    expect(await gitStatus(mine)).toMatchObject({ branch: "collegue/y", upstream: "origin/collegue/y" });
    await switchBranch(mine, "main");
  }, 30_000);

  it("crée une branche en gardant les modifications, et refuse un nom invalide", async () => {
    await writeFile(join(mine, "g.txt"), "en cours");
    await createBranch(mine, "aqn/feat/g");
    expect(await gitStatus(mine)).toMatchObject({ branch: "aqn/feat/g", untracked: 1 });
    await expect(createBranch(mine, "nom invalide..")).rejects.toThrow("pas un nom de branche valide");
    await rm(join(mine, "g.txt"));
    await switchBranch(mine, "main");
  }, 30_000);

  it("crée un worktree sous .claude/worktrees pour une branche neuve", async () => {
    const path = await createWorktree(mine, "aqn/feat/ailleurs");
    expect(path.replace(/\\/g, "/")).toMatch(/\.claude\/worktrees\/aqn-feat-ailleurs$/);
    expect((await stat(path)).isDirectory()).toBe(true);
    expect((await gitStatus(path))?.branch).toBe("aqn/feat/ailleurs");
    // Rangé dans le dépôt, le worktree ne doit pas y compter comme une modification.
    expect((await gitStatus(mine))?.changed).toBe(0);
    await createWorktree(mine, "aqn/feat/encore");
    const exclude = await readFile(join(mine, ".git", "info", "exclude"), "utf8");
    expect(exclude.split("\n").filter((line) => line === "/.claude/worktrees/")).toHaveLength(1);
    await git(mine, "worktree", "remove", path);
    await git(mine, "worktree", "remove", join(mine, ".claude", "worktrees", "aqn-feat-encore"));
  }, 30_000);

  it("exclut les fichiers que Clide écrit pour les dossiers liés, une seule fois", async () => {
    await excludeClideFiles(mine);
    expect(await readFile(join(mine, ".git", "info", "exclude"), "utf8")).not.toContain("clide");

    await new LinkStore().write(mine, [{ path: scratch, role: "voisin", readOnly: true }]);
    expect((await gitStatus(mine))?.untracked).toBeGreaterThan(0);

    await excludeClideFiles(mine);
    await excludeClideFiles(mine);
    expect((await gitStatus(mine))?.untracked).toBe(0);
    const exclude = await readFile(join(mine, ".git", "info", "exclude"), "utf8");
    expect(exclude.split("\n").filter((line) => line === "/.claude/clide.json")).toHaveLength(1);
    await expect(excludeClideFiles(scratch)).resolves.toBeUndefined();
    await rm(join(mine, ".claude"), { recursive: true, force: true });
  }, 30_000);

  it("change de branche malgré un fichier non suivi, sans rien mettre de côté", async () => {
    await writeFile(join(mine, "brouillon-non-suivi.txt"), "x");
    await createBranch(mine, "aqn/feat/non-suivi");
    await expect(switchBranch(mine, "main")).resolves.toEqual({ stashed: false });
    expect(await stashCount(mine)).toBe(0);
    await rm(join(mine, "brouillon-non-suivi.txt"));
  }, 30_000);
});

/** Ce que le pull groupé ne peut que rapporter : l'état n'est connu qu'après le fetch. */
describe("pull groupé : amont supprimé, divergé ou réécrit", () => {
  let scratch: string;
  let remote: string;
  let mine: string;
  let theirs: string;

  const commit = async (cwd: string, file: string, text: string) => {
    await writeFile(join(cwd, file), text);
    await git(cwd, "add", file);
    await git(cwd, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", `ajoute ${file}`);
  };

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), "clide-pull-"));
    remote = join(scratch, "remote.git");
    mine = join(scratch, "mine");
    theirs = join(scratch, "theirs");
    await git(scratch, "init", "--bare", "-b", "main", remote);
    await git(scratch, "clone", remote, mine);
    await git(mine, "checkout", "-b", "main");
    await commit(mine, "a.txt", "a");
    await git(mine, "push", "-u", "origin", "main");
    await git(scratch, "clone", remote, theirs);
  }, 60_000);

  afterAll(async () => {
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  it("écarte une branche supprimée sur le serveur dont la ref de suivi locale existe encore", async () => {
    await git(mine, "checkout", "-b", "aqn/fix/fusionnee");
    await git(mine, "push", "-u", "origin", "aqn/fix/fusionnee");
    await git(theirs, "push", "origin", "--delete", "aqn/fix/fusionnee");
    expect((await gitStatus(mine))?.upstreamGone).toBeUndefined();

    expect(await pullMany([mine])).toEqual([{ root: mine, outcome: "skipped", reason: "upstream-gone" }]);
    await git(mine, "checkout", "main");
  }, 30_000);

  it("rapporte une branche divergée sans rien fusionner", async () => {
    await commit(theirs, "distant.txt", "d");
    await git(theirs, "push");
    await commit(mine, "local.txt", "l");
    const head = (await git(mine, "rev-parse", "HEAD")).stdout.trim();

    expect(await pullMany([mine])).toEqual([
      { root: mine, outcome: "diverged", branch: "main", ahead: 1, behind: 1, unrelated: false },
    ]);
    expect((await git(mine, "rev-parse", "HEAD")).stdout.trim()).toBe(head);
    await git(mine, "reset", "--hard", "origin/main");
  }, 30_000);

  it("reconnaît un amont réécrit, sans ancêtre commun", async () => {
    await git(theirs, "checkout", "--orphan", "neuf");
    await commit(theirs, "v2.txt", "v2");
    await git(theirs, "push", "--force", "origin", "neuf:main");

    expect(await pullMany([mine])).toEqual([
      { root: mine, outcome: "diverged", branch: "main", ahead: 2, behind: 1, unrelated: true },
    ]);
  }, 30_000);
});
