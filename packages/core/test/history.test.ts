import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileHistoryResolver } from "../src/files/history.js";
import type { FileTrack } from "../src/session/projection.js";

const SESSION = "0350d6a5-5bec-4df4-ba51-45df51df60f7";

let home: string;
let project: string;
let resolver: FileHistoryResolver;

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), "clide-history-"));
  home = join(root, ".claude");
  project = join(root, "projet");
  await mkdir(join(home, "file-history", SESSION), { recursive: true });
  await mkdir(join(project, "src"), { recursive: true });
  resolver = new FileHistoryResolver(home);
});

afterEach(async () => {
  await rm(join(home, ".."), { recursive: true, force: true });
});

async function writeBackup(name: string, content: string): Promise<void> {
  await writeFile(join(home, "file-history", SESSION, name), content, "utf8");
}

const modified = (backups: { backupFileName: string | null; version: number }[]): FileTrack => ({
  trackingPath: "src\\app.ts",
  created: backups.every((b) => b.backupFileName === null),
  backups,
});

describe("FileHistoryResolver", () => {
  it("diffe la sauvegarde d'origine contre le fichier courant", async () => {
    await writeBackup("aaaa000000000001@v1", "const a = 1;\nconst b = 2;\n");
    await writeFile(join(project, "src", "app.ts"), "const a = 1;\nconst b = 3;\nconst c = 4;\n");

    const diff = await resolver.diff(
      SESSION,
      modified([{ backupFileName: "aaaa000000000001@v1", version: 1 }]),
      project,
    );

    expect(diff.created).toBe(false);
    expect(diff.deleted).toBe(false);
    expect(diff.beforeMissing).toBe(false);
    expect(diff.linesAdded).toBe(2);
    expect(diff.linesRemoved).toBe(1);
    expect(diff.unified).toContain("--- a/src/app.ts");
    expect(diff.unified).toContain("+++ b/src/app.ts");
    expect(diff.unified).toContain("-const b = 2;");
    expect(diff.unified).toContain("+const c = 4;");
  });

  it("part de la première version quand plusieurs sauvegardes existent", async () => {
    await writeBackup("aaaa000000000001@v1", "depart\n");
    await writeBackup("aaaa000000000001@v2", "intermediaire\n");
    await writeFile(join(project, "src", "app.ts"), "arrivee\n");

    const diff = await resolver.diff(
      SESSION,
      modified([
        { backupFileName: "aaaa000000000001@v1", version: 1 },
        { backupFileName: "aaaa000000000001@v2", version: 2 },
      ]),
      project,
    );

    expect(diff.unified).toContain("-depart");
    expect(diff.unified).not.toContain("intermediaire");
  });

  it("diffe un fichier créé contre le vide", async () => {
    await writeFile(join(project, "src", "nouveau.ts"), "ligne 1\nligne 2\n");

    const diff = await resolver.diff(
      SESSION,
      { trackingPath: "src\\nouveau.ts", created: true, backups: [{ backupFileName: null, version: 1 }] },
      project,
    );

    expect(diff.created).toBe(true);
    expect(diff.beforeMissing).toBe(false);
    expect(diff.linesAdded).toBe(2);
    expect(diff.linesRemoved).toBe(0);
    expect(diff.unified).toContain("--- /dev/null");
    expect(diff.unified).toContain("+++ b/src/nouveau.ts");
  });

  it("marque un fichier disparu comme supprimé", async () => {
    await writeBackup("aaaa000000000001@v1", "contenu\n");

    const diff = await resolver.diff(
      SESSION,
      modified([{ backupFileName: "aaaa000000000001@v1", version: 1 }]),
      project,
    );

    expect(diff.deleted).toBe(true);
    expect(diff.linesRemoved).toBe(1);
    expect(diff.unified).toContain("+++ /dev/null");
  });

  it("signale une sauvegarde absente au lieu d'inventer un diff", async () => {
    await writeFile(join(project, "src", "app.ts"), "peu importe\n");

    const diff = await resolver.diff(
      SESSION,
      modified([{ backupFileName: "introuvable@v1", version: 1 }]),
      project,
    );

    expect(diff.beforeMissing).toBe(true);
    expect(diff.unified).toBe("");
    expect(diff.linesAdded).toBe(0);
  });

  it("rend un diff vide quand le fichier a retrouvé son état d'origine", async () => {
    await writeBackup("aaaa000000000001@v1", "identique\n");
    await writeFile(join(project, "src", "app.ts"), "identique\n");

    const diff = await resolver.diff(
      SESSION,
      modified([{ backupFileName: "aaaa000000000001@v1", version: 1 }]),
      project,
    );

    expect(diff.unified).toBe("");
    expect(diff.linesAdded).toBe(0);
    expect(diff.linesRemoved).toBe(0);
  });

  it("ne tente pas de diffe un binaire", async () => {
    await writeBackup("aaaa000000000001@v1", "avant\u0000binaire\n");
    await writeFile(join(project, "src", "app.ts"), "apres\u0000binaire\n");

    const diff = await resolver.diff(
      SESSION,
      modified([{ backupFileName: "aaaa000000000001@v1", version: 1 }]),
      project,
    );

    expect(diff.binary).toBe(true);
    expect(diff.unified).toBe("");
  });

  it("trie les fichiers d'une session par chemin", async () => {
    await writeFile(join(project, "src", "b.ts"), "b\n");
    await writeFile(join(project, "src", "a.ts"), "a\n");

    const diffs = await resolver.diffSession(
      SESSION,
      [
        { trackingPath: "src\\b.ts", created: true, backups: [{ backupFileName: null, version: 1 }] },
        { trackingPath: "src\\a.ts", created: true, backups: [{ backupFileName: null, version: 1 }] },
      ],
      project,
    );

    expect(diffs.map((d) => d.trackingPath)).toEqual(["src\\a.ts", "src\\b.ts"]);
  });

  it("date un fichier de sa sauvegarde la plus récente, quel que soit l'ordre des versions", async () => {
    await writeFile(join(project, "src", "a.ts"), "a\n");
    const [dated, undated] = await resolver.diffSession(
      SESSION,
      [
        {
          trackingPath: "src\\a.ts",
          created: true,
          backups: [
            { backupFileName: null, version: 1, backupTime: "2026-09-25T10:00:00.000Z" },
            { backupFileName: null, version: 2, backupTime: "2026-09-25T09:00:00.000Z" },
          ],
        },
        { trackingPath: "src\\b.ts", created: true, backups: [{ backupFileName: null, version: 1 }] },
      ],
      project,
    );

    expect(dated?.changedAt).toBe("2026-09-25T10:00:00.000Z");
    expect(undated?.changedAt).toBeUndefined();
  });
});
