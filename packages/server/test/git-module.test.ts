import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { gitModule } from "../src/modules/git.js";
import type { ApiContext } from "../src/api/routes.js";

const context = {} as ApiContext;
const route = (path: string) => gitModule.routes?.[path] as (params: URLSearchParams, context: ApiContext) => Promise<unknown>;
const mutation = (path: string) =>
  gitModule.mutations?.[path] as (params: URLSearchParams, context: ApiContext, body: Record<string, unknown>) => Promise<unknown>;

describe("module git", () => {
  let repo: string;
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), "clide-git-"));
    git("init", "-q", "-b", "main");
    git("config", "user.email", "test@example.invalid");
    git("config", "user.name", "Test");
    git("config", "core.autocrlf", "false");
    await writeFile(join(repo, "a.txt"), "un\n");
    await writeFile(join(repo, "b.txt"), "deux\n");
    git("add", ".");
    git("commit", "-q", "-m", "Premier");
  });

  afterAll(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it("liste les modifications et ne commite que les fichiers choisis, nouveaux compris", async () => {
    await writeFile(join(repo, "a.txt"), "un modifié\n");
    await writeFile(join(repo, "b.txt"), "deux modifié\n");
    await writeFile(join(repo, "nouveau.md"), "neuf\n");
    const { changes } = (await route("/api/git/changes")(new URLSearchParams({ root: repo }), context)) as {
      changes: { path: string; kind: string }[];
    };
    expect(changes.map((change) => `${change.kind}:${change.path}`)).toEqual(["modified:a.txt", "modified:b.txt", "untracked:nouveau.md"]);

    await mutation("/api/git/commit")(new URLSearchParams(), context, {
      root: repo,
      message: "Deux fichiers sur trois",
      paths: ["a.txt", "nouveau.md"],
      untracked: ["nouveau.md"],
    });
    expect(git("status", "--porcelain").trim()).toBe("M b.txt");
    expect(git("log", "-1", "--format=%s").trim()).toBe("Deux fichiers sur trois");
  });

  it("refuse un message vide ou une sélection vide", async () => {
    const commit = mutation("/api/git/commit");
    await expect(commit(new URLSearchParams(), context, { root: repo, message: " ", paths: ["b.txt"] })).rejects.toThrow(/vide/);
    await expect(commit(new URLSearchParams(), context, { root: repo, message: "x", paths: [] })).rejects.toThrow(/aucun fichier/);
  });

  it("amende le dernier commit, message seul", async () => {
    await mutation("/api/git/commit")(new URLSearchParams(), context, { root: repo, message: "Message corrigé", paths: [], amend: true });
    const { message } = (await route("/api/git/last-message")(new URLSearchParams({ root: repo }), context)) as { message: string };
    expect(message).toBe("Message corrigé");
  });

  it("rend le journal avec ses voies, le détail d'un commit et ses deux côtés de diff", async () => {
    const { commits, rows } = (await route("/api/git/log")(new URLSearchParams({ root: repo }), context)) as {
      commits: { hash: string; subject: string; refs: string[] }[];
      rows: { column: number }[];
    };
    expect(commits.map((commit) => commit.subject)).toEqual(["Message corrigé", "Premier"]);
    expect(commits[0]?.refs).toContain("main");
    expect(rows.map((row) => row.column)).toEqual([0, 0]);

    const head = commits[0]?.hash as string;
    const show = (await route("/api/git/show")(new URLSearchParams({ root: repo, hash: head }), context)) as {
      files: { path: string; kind: string }[];
    };
    expect(show.files).toEqual([
      { path: "a.txt", kind: "modified" },
      { path: "nouveau.md", kind: "added" },
    ]);

    const committed = (await route("/api/git/diff")(new URLSearchParams({ root: repo, path: "a.txt", ref: head }), context)) as {
      original: string;
      modified: string;
    };
    expect(committed).toEqual({ original: "un\n", modified: "un modifié\n" });
    const working = (await route("/api/git/diff")(new URLSearchParams({ root: repo, path: "b.txt" }), context)) as {
      original: string;
      modified: string;
    };
    expect(working).toEqual({ original: "deux\n", modified: await readFile(join(repo, "b.txt"), "utf8") });
  });

  it("refuse un chemin de diff qui sort du dépôt", async () => {
    await expect(route("/api/git/diff")(new URLSearchParams({ root: repo, path: "../ailleurs.txt" }), context)).rejects.toThrow(
      /hors du projet/,
    );
  });
});
