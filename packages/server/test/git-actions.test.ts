import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DirtyTreeError,
  createBranch,
  createWorktree,
  gitPull,
  gitPush,
  gitStatus,
  listBranches,
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
      changed: 2,
      conflicted: 1,
    });
  });

  it("reconnaît un HEAD détaché et un dépôt sans commit", () => {
    expect(parseStatusV2("# branch.oid (initial)\n# branch.head (detached)\n")).toEqual({
      ahead: 0,
      behind: 0,
      changed: 0,
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
    scratch = await mkdtemp(join(tmpdir(), "claude-ide-git-"));
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
    expect(await gitStatus(mine)).toMatchObject({ branch: "aqn/feat/g", changed: 1 });
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
});
