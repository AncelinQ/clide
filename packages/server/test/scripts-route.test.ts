import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { samePath } from "@clide/core";

import type { ApiContext } from "../src/api/routes.js";
import { scripts } from "../src/modules/scripts.js";

const run = promisify(execFile);
const git = (cwd: string, ...args: string[]) => run("git", args, { cwd, windowsHide: true });

interface Listed {
  root: string;
  sources: { scripts: { name: string }[] }[];
  worktrees: { root: string; branch?: string; main: boolean; sources: { scripts: { name: string }[] }[] }[];
}

/** Un dépôt et un worktree sur une branche à lui, chacun avec son `package.json`. */
describe("/api/scripts", () => {
  let scratch: string;
  let main: string;
  let worktree: string;

  const list = async (root: string): Promise<Listed> => {
    const route = scripts.routes?.["/api/scripts"];
    if (!route) throw new Error("route absente");
    return (await route(new URLSearchParams({ root }), {} as ApiContext)) as Listed;
  };

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), "clide-scripts-"));
    main = join(scratch, "app");
    worktree = join(scratch, "app-feature");
    await git(scratch, "init", "-b", "main", main);
    await writeFile(join(main, "package.json"), JSON.stringify({ name: "app", scripts: { dev: "vite" } }));
    await git(main, "add", "package.json");
    await git(main, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "init");
    await git(main, "worktree", "add", "-b", "aqn/feat/x", worktree);
  }, 60_000);

  afterAll(async () => {
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  it("montre les scripts des autres worktrees du dépôt, pas ceux du projet une seconde fois", async () => {
    const listed = await list(main);
    expect(listed.sources[0]?.scripts.map((script) => script.name)).toEqual(["dev"]);
    expect(listed.worktrees).toHaveLength(1);
    expect(listed.worktrees[0]).toMatchObject({ branch: "aqn/feat/x", main: false });
    expect(listed.worktrees[0]?.sources[0]?.scripts.map((script) => script.name)).toEqual(["dev"]);
  });

  it("montre le dépôt principal depuis un worktree", async () => {
    const listed = await list(worktree);
    expect(listed.worktrees).toHaveLength(1);
    expect(listed.worktrees[0]).toMatchObject({ branch: "main", main: true });
    expect(samePath(listed.worktrees[0]?.root ?? "", listed.root)).toBe(false);
  });
});
