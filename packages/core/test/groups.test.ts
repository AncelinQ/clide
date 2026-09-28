import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { fromGroupDirectory, groupsFile, readGroups, toGroupDirectory, writeGroups } from "../src/scripts/groups.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "clide-groups-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("groupes de scripts", () => {
  it("écrit puis relit les groupes, sans les entrées abîmées", async () => {
    await writeGroups(root, [
      { id: "g1", label: "Tout démarrer", scripts: [{ directory: "", name: "dev", run: "pnpm run dev" }] },
    ]);
    expect(await readGroups(root)).toEqual([
      { id: "g1", label: "Tout démarrer", scripts: [{ directory: "", name: "dev", run: "pnpm run dev" }] },
    ]);
    await writeFile(groupsFile(root), JSON.stringify({ version: 1, groups: [{ id: "x" }, { id: "g2", label: "B", scripts: [] }] }));
    expect((await readGroups(root)).map((group) => group.id)).toEqual(["g2"]);
  });

  it("refuse un fichier qui n'est pas du JSON", async () => {
    await mkdir(join(root, ".claude"));
    await writeFile(groupsFile(root), "{ oups");
    await expect(readGroups(root)).rejects.toThrow();
  });

  it("range les dossiers relativement au projet, dossiers liés voisins compris", () => {
    const linked = join(root, "..", "api");
    expect(toGroupDirectory(root, root)).toBe("");
    expect(toGroupDirectory(root, linked)).toBe("../api");
    expect(fromGroupDirectory(root, "../api")).toBe(linked);
  });
});
