import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileHistoryResolver } from "../src/files/history.js";
import { applyRestore, lastSessionWrites, planRestore } from "../src/files/restore.js";
import type { FileTrack } from "../src/session/projection.js";
import type { TranscriptEvent } from "../src/transcript/events.js";

const SESSION = "0350d6a5-5bec-4df4-ba51-45df51df60f7";
const WRITTEN_AT = "2026-09-01T10:00:00.000Z";

let base: string;
let home: string;
let project: string;
let resolver: FileHistoryResolver;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "clide-restore-"));
  home = join(base, ".claude");
  project = join(base, "projet");
  await mkdir(join(home, "file-history", SESSION), { recursive: true });
  await mkdir(join(project, "src"), { recursive: true });
  resolver = new FileHistoryResolver(home);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true, maxRetries: 3 });
});

/** Un appel `Edit` sur `path` et son résultat, consigné à `at`. */
function edit(path: string, at: string, failed = false): TranscriptEvent[] {
  return [
    {
      type: "assistant",
      timestamp: at,
      message: { content: [{ type: "tool_use", id: `t-${at}`, name: "Edit", input: { file_path: path } }] },
    },
    {
      type: "user",
      timestamp: at,
      message: { content: [{ type: "tool_result", tool_use_id: `t-${at}`, ...(failed ? { is_error: true } : {}) }] },
    },
  ] as TranscriptEvent[];
}

const modified: FileTrack = {
  trackingPath: "src\\app.ts",
  created: false,
  backups: [{ backupFileName: "aaaa@v1", version: 1 }],
};

async function setUp(current: string, writtenAt = WRITTEN_AT, touchedAt = WRITTEN_AT) {
  await writeFile(join(home, "file-history", SESSION, "aaaa@v1"), "avant\n");
  const file = join(project, "src", "app.ts");
  await writeFile(file, current);
  const touched = new Date(touchedAt);
  await utimes(file, touched, touched);
  return lastSessionWrites(edit(join(project, "src", "app.ts"), writtenAt), project);
}

const plan = (writes: Map<string, number>, track = modified) =>
  planRestore({ sessionId: SESSION, track, root: project, writes, resolver });

describe("planRestore", () => {
  it("montre ce qui sera écrasé, du fichier actuel vers son état d'origine", async () => {
    const result = await plan(await setUp("après\n"));
    expect(result.blocked).toBeUndefined();
    expect(result.action).toBe("overwrite");
    expect(result.unified).toContain("-après");
    expect(result.unified).toContain("+avant");
  });

  it("refuse un fichier modifié après la dernière écriture de la session", async () => {
    const result = await plan(await setUp("retouché\n", WRITTEN_AT, "2026-09-01T11:00:00.000Z"));
    expect(result.blocked).toMatch(/modifié après/);
  });

  it("admet la réécriture immédiate d'un formateur", async () => {
    const result = await plan(await setUp("formaté\n", WRITTEN_AT, "2026-09-01T10:00:02.000Z"));
    expect(result.blocked).toBeUndefined();
  });

  it("refuse un fichier que la session n'a écrit que par un appel en échec", async () => {
    await setUp("après\n");
    const writes = lastSessionWrites(edit(join(project, "src", "app.ts"), WRITTEN_AT, true), project);
    expect((await plan(writes)).blocked).toMatch(/aucune écriture/);
  });

  it("refuse sans la sauvegarde d'origine", async () => {
    const writes = await setUp("après\n");
    const track = { ...modified, backups: [{ backupFileName: "inconnue@v1", version: 1 }] };
    expect((await plan(writes, track)).blocked).toMatch(/sauvegarde/);
  });

  it("n'a rien à faire sur un fichier déjà revenu à son état d'origine", async () => {
    expect((await plan(await setUp("avant\n"))).blocked).toMatch(/déjà/);
  });
});

describe("applyRestore", () => {
  it("garde une copie du contenu actuel avant de l'écraser", async () => {
    const restoring = await plan(await setUp("après\n"));
    const backupDir = join(base, "restores");
    const { backup } = await applyRestore(restoring, {
      expectedHash: restoring.currentHash,
      backupDir,
      trash: async () => {},
    });
    expect(await readFile(join(project, "src", "app.ts"), "utf8")).toBe("avant\n");
    expect(await readFile(backup!, "utf8")).toBe("après\n");
    expect(await readdir(join(project, "src"))).toEqual(["app.ts"]);
  });

  it("refuse si le fichier a changé depuis l'aperçu", async () => {
    const restoring = await plan(await setUp("après\n"));
    await expect(
      applyRestore(restoring, { expectedHash: "autre", backupDir: join(base, "restores"), trash: async () => {} }),
    ).rejects.toThrow(/changé depuis l'aperçu/);
    expect(await readFile(join(project, "src", "app.ts"), "utf8")).toBe("après\n");
  });

  it("met à la corbeille un fichier créé par la session", async () => {
    const file = join(project, "src", "new.ts");
    await writeFile(file, "neuf\n");
    const touched = new Date(WRITTEN_AT);
    await utimes(file, touched, touched);
    const created: FileTrack = { trackingPath: "src\\new.ts", created: true, backups: [{ backupFileName: null, version: 1 }] };
    const restoring = await plan(lastSessionWrites(edit(file, WRITTEN_AT), project), created);
    expect(restoring.action).toBe("remove");
    const trashed: string[] = [];
    await applyRestore(restoring, {
      expectedHash: restoring.currentHash,
      backupDir: join(base, "restores"),
      trash: async (paths) => void trashed.push(...paths),
    });
    expect(trashed).toEqual([file]);
  });
});
