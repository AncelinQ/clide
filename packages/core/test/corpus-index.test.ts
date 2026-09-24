import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { FileHistoryResolver } from "../src/files/history.js";
import { claudeHome, projectsDir } from "../src/paths.js";
import { SessionIndex } from "../src/session/session-index.js";
import { TranscriptReader } from "../src/transcript/reader.js";
import { discoverTranscripts } from "../src/transcript/discover.js";

/**
 * Critères d'acceptation A3b et A4, mesurés sur le corpus réel de la machine.
 * Ignorés là où il n'y en a pas, pour que la suite reste verte en CI.
 */
const hasCorpus = existsSync(projectsDir(claudeHome()));

let scratch: string | undefined;

afterAll(async () => {
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

describe.skipIf(!hasCorpus)("corpus réel — index et diffs", () => {
  it(
    "liste les sessions en moins de 150 ms à chaud",
    async () => {
      scratch = await mkdtemp(join(tmpdir(), "clide-bench-"));
      const indexFile = join(scratch, "session-index.json");

      const coldStart = Date.now();
      const cold = new SessionIndex({ indexFile });
      const built = await cold.refresh();
      await cold.save();
      const coldMs = Date.now() - coldStart;

      const warmStart = Date.now();
      const warm = new SessionIndex({ indexFile });
      await warm.load();
      const sessions = warm.list();
      const warmMs = Date.now() - warmStart;

      const refreshStart = Date.now();
      const incremental = await warm.refresh();
      const refreshMs = Date.now() - refreshStart;

      console.log(
        JSON.stringify(
          {
            indexation: { ...built, coldMs },
            aChaud: { sessions: sessions.length, warmMs },
            rafraichissement: { ...incremental, refreshMs },
            avecTitre: sessions.filter((s) => s.title).length,
            avecMr: sessions.filter((s) => s.prLinks.length > 0).length,
            deplacees: sessions.filter((s) => s.effectiveCwd?.includes("worktrees")).length,
          },
          null,
          2,
        ),
      );

      expect(sessions.length).toBeGreaterThan(0);
      expect(warmMs).toBeLessThan(150);

      // Le corpus est vivant : les sessions Claude Code en cours écrivent pendant
      // que l'index se construit, et seront donc réindexées. Ce qui doit tenir,
      // c'est que tout le reste soit réutilisé et que le rafraîchissement coûte
      // une fraction de l'indexation complète.
      expect(incremental.reused + incremental.reindexed).toBe(incremental.scanned);
      expect(incremental.reused).toBeGreaterThan(built.scanned * 0.8);
      expect(refreshMs).toBeLessThan(coldMs / 5);
    },
    { timeout: 180_000 },
  );

  it(
    "résout les sauvegardes et calcule les diffs des sessions réelles",
    async () => {
      const refs = (await discoverTranscripts())
        .filter((ref) => ref.kind === "session")
        .slice(0, 25);

      const resolver = new FileHistoryResolver();
      let tracked = 0;
      let created = 0;
      let missing = 0;
      let diffed = 0;
      let added = 0;
      let removed = 0;
      const failures: string[] = [];

      for (const ref of refs) {
        const { projection } = await TranscriptReader.fromRef(ref).poll();
        if (projection.files.length === 0) continue;
        const root = projection.relocatedCwd ?? projection.worktreePath ?? projection.cwd;
        if (!root) continue;

        try {
          const diffs = await resolver.diffSession(ref.sessionId, projection.files, root);
          for (const diff of diffs) {
            tracked += 1;
            if (diff.created) created += 1;
            if (diff.beforeMissing) missing += 1;
            if (diff.unified.length > 0) {
              diffed += 1;
              added += diff.linesAdded;
              removed += diff.linesRemoved;
            }
          }
        } catch (error) {
          failures.push(`${ref.sessionId}: ${String(error)}`);
        }
      }

      console.log(
        JSON.stringify(
          {
            sessionsExaminees: refs.length,
            fichiersSuivis: tracked,
            crees: created,
            sauvegardeIntrouvable: missing,
            diffsCalcules: diffed,
            lignes: { ajoutees: added, supprimees: removed },
            echecs: failures,
          },
          null,
          2,
        ),
      );

      expect(failures).toEqual([]);
      expect(tracked).toBeGreaterThan(0);
      expect(diffed).toBeGreaterThan(0);
    },
    { timeout: 180_000 },
  );

  it("résout un backup réel jusqu'à son contenu", async () => {
    const refs = (await discoverTranscripts()).filter((ref) => ref.kind === "session");
    for (const ref of refs) {
      const { projection } = await TranscriptReader.fromRef(ref).poll();
      const track = projection.files.find((f) => !f.created);
      if (!track) continue;

      const resolver = new FileHistoryResolver();
      const before = await resolver.readBefore(ref.sessionId, track);
      if (before.missing) continue;

      expect(before.content.length).toBeGreaterThan(0);
      return;
    }
    // Aucun fichier modifié dans le corpus : rien à prouver, mais il faut le dire.
    console.log("aucun fichier modifié avec sauvegarde lisible dans le corpus");
  }, 180_000);
});

describe("écriture atomique de l'index", () => {
  it("laisse l'index précédent intact si l'écriture ne va pas au bout", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clide-atomic-"));
    const home = join(dir, ".claude");
    await mkdir(join(home, "projects", "C--x"), { recursive: true });
    await writeFile(join(home, "projects", "C--x", "s.jsonl"), '{"type":"user"}\n', "utf8");

    const indexFile = join(dir, "index.json");
    const index = new SessionIndex({ home, indexFile });
    await index.refresh();
    await index.save();

    // Un fichier temporaire abandonné ne doit pas être pris pour l'index.
    await writeFile(`${indexFile}.99999.tmp`, "moitie ecrit", "utf8");

    const reloaded = new SessionIndex({ home, indexFile });
    await reloaded.load();
    expect(reloaded.size).toBe(1);

    await rm(dir, { recursive: true, force: true });
  });
});
