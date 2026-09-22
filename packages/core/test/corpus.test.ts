import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { claudeHome, projectsDir } from "../src/paths.js";
import { discoverTranscripts } from "../src/transcript/discover.js";
import { TranscriptReader } from "../src/transcript/reader.js";

/**
 * Point de contrôle G1 : rejouer le corpus réel de la machine.
 *
 * Un type d'event inconnu n'est pas un échec — il est attendu, et il est
 * rapporté. Une exception ou une ligne illisible en est un : elles signalent que
 * le lecteur casse sur du contenu que Claude Code écrit vraiment.
 *
 * Ignoré là où aucun corpus n'existe, pour que la suite reste verte sur une
 * machine vierge et en CI.
 */
const CORPUS = projectsDir(claudeHome());
const hasCorpus = existsSync(CORPUS);

describe.skipIf(!hasCorpus)("corpus réel", () => {
  it(
    "se rejoue sans exception ni ligne illisible",
    async () => {
      const refs = await discoverTranscripts();
      expect(refs.length).toBeGreaterThan(0);

      const unknownTypes = new Map<string, number>();
      const failures: { path: string; error: string }[] = [];
      let events = 0;
      let malformed = 0;
      let bytes = 0;
      let withoutTitle = 0;
      let relocated = 0;

      const started = Date.now();
      for (const ref of refs) {
        try {
          const reader = TranscriptReader.fromRef(ref);
          const { projection, stats } = await reader.poll();

          events += stats.events;
          malformed += stats.malformed;
          bytes += stats.bytes;
          if (ref.kind === "session" && !projection.title) withoutTitle += 1;
          if (projection.relocatedCwd) relocated += 1;
          for (const [type, count] of Object.entries(projection.unknownTypes)) {
            unknownTypes.set(type, (unknownTypes.get(type) ?? 0) + count);
          }
        } catch (error) {
          failures.push({ path: ref.path, error: String(error) });
        }
      }

      const report = {
        generatedAt: new Date().toISOString(),
        transcripts: refs.length,
        sessions: refs.filter((r) => r.kind === "session").length,
        subagents: refs.filter((r) => r.kind === "subagent").length,
        unclassified: refs.filter((r) => r.kind === "unclassified").length,
        events,
        malformedLines: malformed,
        megabytes: Number((bytes / 1024 / 1024).toFixed(1)),
        elapsedMs: Date.now() - started,
        sessionsWithoutTitle: withoutTitle,
        sessionsRelocated: relocated,
        unknownTypes: Object.fromEntries([...unknownTypes].sort((a, b) => b[1] - a[1])),
        failures,
      };

      const outDir = join(import.meta.dirname, "..", "reports");
      await mkdir(outDir, { recursive: true });
      await writeFile(join(outDir, "corpus-g1.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
      console.log(JSON.stringify(report, null, 2));

      expect(failures).toEqual([]);
      expect(malformed).toBe(0);
    },
    { timeout: 180_000 },
  );
});
