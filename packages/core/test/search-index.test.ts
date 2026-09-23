import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SearchIndex, fold } from "../src/search/search-index.js";

let home: string;
let file: string;
const SID = "0350d6a5-5bec-4df4-ba51-45df51df60f7";

const line = (event: Record<string, unknown>): string => `${JSON.stringify(event)}\n`;
const prompt = (text: string, timestamp: string) =>
  line({ type: "user", timestamp, message: { role: "user", content: [{ type: "text", text }] } });
const bash = (command: string, timestamp: string) =>
  line({
    type: "assistant",
    timestamp,
    message: { id: `m-${timestamp}`, content: [{ type: "tool_use", id: `t-${timestamp}`, name: "Bash", input: { command } }] },
  });

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "claude-ide-search-"));
  await mkdir(join(home, "projects", "C--Projets-app"), { recursive: true });
  file = join(home, "projects", "C--Projets-app", `${SID}.jsonl`);
  await writeFile(
    file,
    prompt("Prépare la réponse au ticket HN-12528", "2026-09-01T10:00:00Z") +
      bash(`glab mr create --title "${"x".repeat(300)} fin-de-commande"`, "2026-09-01T10:05:00Z"),
    "utf8",
  );
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 3 });
});

describe("SearchIndex", () => {
  it("trouve sans accents ni casse, et dit où ouvrir la session", async () => {
    const index = new SearchIndex({ home, indexFile: join(home, "search.json") });
    await index.refresh();
    const { hits } = index.search("REPONSE hn-12528");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ sessionId: SID, index: 0, kind: "prompt" });
  });

  it("cherche dans la commande entière, pas dans son résumé tronqué", async () => {
    const index = new SearchIndex({ home, indexFile: join(home, "search.json") });
    await index.refresh();
    expect(index.search("fin-de-commande").hits[0]).toMatchObject({ kind: "tool", name: "Bash", index: 1 });
  });

  it("ne relit qu'un transcript qui a changé, et voit ce qui s'y est ajouté", async () => {
    const indexFile = join(home, "search.json");
    const first = new SearchIndex({ home, indexFile });
    await first.refresh();
    await first.save();

    const second = new SearchIndex({ home, indexFile });
    expect(await second.refresh()).toEqual({ reindexed: 0, reused: 1 });

    await appendFile(file, prompt("nouvelle demande", "2026-09-02T10:00:00Z"), "utf8");
    expect(await second.refresh()).toEqual({ reindexed: 1, reused: 0 });
    expect(second.search("nouvelle").hits[0]?.index).toBe(2);
  });

  it("rend les plus récents d'abord", async () => {
    await appendFile(file, prompt("encore la réponse", "2026-09-03T10:00:00Z"), "utf8");
    const index = new SearchIndex({ home, indexFile: join(home, "search.json") });
    await index.refresh();
    expect(index.search("reponse").hits.map((hit) => hit.index)).toEqual([2, 0]);
  });
});

describe("fold", () => {
  it("retire accents et casse", () => {
    expect(fold("Réponse À Élodie")).toBe("reponse a elodie");
  });
});
