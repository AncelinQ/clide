import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ProjectMemo } from "@clide/core";

import type { ApiContext } from "../src/api/routes.js";
import { memoModule } from "../src/modules/memo.js";
import { OutsideWorkspace, WorkspaceRoots } from "../src/workspace/roots.js";

describe("module memo", () => {
  let dir: string;
  let project: string;
  let context: ApiContext;
  const trashed: string[] = [];
  const memo = memoModule(async (paths) => {
    trashed.push(...paths);
    await Promise.all(paths.map((path) => rm(path)));
  });

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "clide-memo-srv-"));
    project = join(dir, "projet");
    await mkdir(project);
    await writeFile(join(project, "README.md"), "");
    const workspace = new WorkspaceRoots(async () => []);
    await workspace.update([project]);
    context = { dataDir: join(dir, "data"), workspace } as unknown as ApiContext;
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const read = async (): Promise<ProjectMemo> =>
    ((await (memo.routes?.["/api/memo"] as (params: URLSearchParams, context: ApiContext) => Promise<{ memo: ProjectMemo }>)(
      new URLSearchParams({ root: project }),
      context,
    )) as { memo: ProjectMemo }).memo;
  const post = (path: string, body: Record<string, unknown>) =>
    (memo.mutations?.[path] as (params: URLSearchParams, context: ApiContext, body: Record<string, unknown>) => Promise<Record<string, unknown>>)(
      new URLSearchParams(),
      context,
      { root: project, ...body },
    );

  it("ajoute, modifie, range et retire des liens", async () => {
    expect(await post("/api/memo/links/put", { link: { name: "", url: "exemple.fr" } })).toEqual({ link: { name: "exemple.fr", url: "https://exemple.fr" } });
    await post("/api/memo/links/put", { link: { name: "Ticket", url: "https://linear.app/x" } });
    await expect(post("/api/memo/links/put", { link: { name: "", url: "https://exemple.fr" } })).rejects.toThrow(/déjà dans le mémo/);
    await post("/api/memo/links/put", { link: { name: "Doc", url: "https://exemple.fr" }, replacing: "https://exemple.fr" });
    await post("/api/memo/links/order", { urls: ["https://linear.app/x"] });
    expect((await read()).links.map((link) => link.name)).toEqual(["Ticket", "Doc"]);
    await post("/api/memo/links/remove", { url: "https://linear.app/x" });
    expect((await read()).links.map((link) => link.name)).toEqual(["Doc"]);
  });

  it("n'épingle que des fichiers des projets ouverts", async () => {
    await expect(post("/api/memo/pins/add", { paths: [join(dir, "ailleurs.md")] })).rejects.toBeInstanceOf(OutsideWorkspace);
    expect(await post("/api/memo/pins/add", { paths: [join(project, "README.md")] })).toEqual({ added: 1 });
    expect((await read()).pins).toEqual([{ path: join(project, "README.md"), exists: true }]);
    await post("/api/memo/pins/remove", { path: join(project, "README.md") });
    expect((await read()).pins).toEqual([]);
  });

  it("crée, renomme et met une note à la corbeille, et la liste parmi tous les mémos", async () => {
    const { path } = (await post("/api/memo/notes/create", { name: "Plan" })) as { path: string };
    const { path: renamed } = (await post("/api/memo/notes/rename", { path, name: "Idées" })) as { path: string };
    expect((await read()).notes.map((note) => note.name)).toEqual(["Idées"]);

    const all = (await (memo.routes?.["/api/memo/all"] as (params: URLSearchParams, context: ApiContext) => Promise<{ memos: ProjectMemo[] }>)(
      new URLSearchParams(),
      context,
    )) as { memos: ProjectMemo[] };
    expect(all.memos.map((item) => item.root)).toEqual([project]);

    await post("/api/memo/notes/trash", { path: renamed });
    expect(trashed).toEqual([renamed]);
    expect((await read()).notes).toEqual([]);
  });

  it("exige le projet dans le corps", async () => {
    await expect(
      (memo.mutations?.["/api/memo/links/remove"] as (params: URLSearchParams, context: ApiContext, body: Record<string, unknown>) => Promise<unknown>)(
        new URLSearchParams(),
        context,
        { url: "https://exemple.fr" },
      ),
    ).rejects.toThrow(/root/);
  });
});
