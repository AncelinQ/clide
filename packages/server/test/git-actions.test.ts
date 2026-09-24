import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { gitPull, gitPush, gitStatus, parseStatusV2, pushPlan } from "../src/platform/git-actions.js";

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
});
