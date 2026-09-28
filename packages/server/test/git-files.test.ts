import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { gitFiles } from "../src/platform/git.js";

describe("gitFiles", () => {
  let repo: string;
  let plain: string;

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), "clide-gitfiles-"));
    plain = await mkdtemp(join(tmpdir(), "clide-plain-"));
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: repo, windowsHide: true });
    git("init", "-q");
    await writeFile(join(repo, ".gitignore"), "ignoré.txt\ndist/\n");
    await writeFile(join(repo, "a.ts"), "");
    await writeFile(join(repo, "supprimé.ts"), "");
    await mkdir(join(repo, "dist"));
    await writeFile(join(repo, "dist", "x.js"), "");
    await writeFile(join(repo, "ignoré.txt"), "");
    git("add", "-A");
    git("commit", "-qm", "init");
    await unlink(join(repo, "supprimé.ts"));
    await mkdir(join(repo, "src"));
    await writeFile(join(repo, "src", "nouveau é.ts"), "");
  });

  afterAll(async () => {
    await rm(repo, { recursive: true, force: true });
    await rm(plain, { recursive: true, force: true });
  });

  it("rend suivis et non suivis hors .gitignore, sans les supprimés, accents compris", async () => {
    expect((await gitFiles(repo))?.sort()).toEqual([".gitignore", "a.ts", "src/nouveau é.ts"]);
  });

  it("rend les chemins relatifs à un sous-dossier du dépôt", async () => {
    expect(await gitFiles(join(repo, "src"))).toEqual(["nouveau é.ts"]);
  });

  it("ne rend rien hors d'un dépôt", async () => {
    expect(await gitFiles(plain)).toBeUndefined();
  });
});
