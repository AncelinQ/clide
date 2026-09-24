import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SessionIndex } from "../src/session/session-index.js";

let root: string;
let home: string;
let indexFile: string;

const PROJECT = "C--Projets-projet-a";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "clide-index-"));
  home = join(root, ".claude");
  indexFile = join(root, "index.json");
  await mkdir(join(home, "projects", PROJECT), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const line = (value: unknown): string => `${JSON.stringify(value)}\n`;

async function writeSession(sessionId: string, events: unknown[]): Promise<string> {
  const path = join(home, "projects", PROJECT, `${sessionId}.jsonl`);
  await writeFile(path, events.map(line).join(""), "utf8");
  return path;
}

async function writeSubagent(sessionId: string, agentId: string, events: unknown[]): Promise<void> {
  const dir = join(home, "projects", PROJECT, sessionId, "subagents");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `agent-${agentId}.jsonl`), events.map(line).join(""), "utf8");
}

const newIndex = (): SessionIndex => new SessionIndex({ home, indexFile });

describe("SessionIndex", () => {
  it("résume les sessions sans exposer leur transcript", async () => {
    await writeSession("aaaaaaaa-0000-4000-8000-000000000001", [
      { type: "user", cwd: "C:\\Projets\\projet-a", gitBranch: "main", timestamp: "2026-09-01T10:00:00.000Z" },
      { type: "ai-title", aiTitle: "refonte du routeur" },
      { type: "assistant", timestamp: "2026-09-01T10:30:00.000Z" },
    ]);

    const index = newIndex();
    await index.refresh();

    const [session] = index.list();
    expect(session?.title).toBe("refonte du routeur");
    expect(session?.effectiveCwd).toBe("C:\\Projets\\projet-a");
    expect(session?.gitBranch).toBe("main");
    expect(session?.messageCount).toBe(2);
    expect(session?.lastActivityAt).toBe("2026-09-01T10:30:00.000Z");
  });

  it("ne réindexe que les transcripts qui ont bougé", async () => {
    const stable = await writeSession("aaaaaaaa-0000-4000-8000-000000000001", [{ type: "user" }]);
    await writeSession("aaaaaaaa-0000-4000-8000-000000000002", [{ type: "user" }]);

    const first = newIndex();
    const initial = await first.refresh();
    expect(initial.reindexed).toBe(2);
    expect(initial.reused).toBe(0);
    await first.save();

    // Une date figée évite qu'un système de fichiers à faible résolution
    // fasse passer un fichier inchangé pour modifié.
    const fixed = new Date("2026-09-01T00:00:00.000Z");
    await utimes(stable, fixed, fixed);

    const second = newIndex();
    await second.load();
    await second.refresh();
    await second.save();

    const third = newIndex();
    const warm = await third.refresh();
    expect(warm.reused).toBe(2);
    expect(warm.reindexed).toBe(0);
  });

  it("réindexe un transcript auquel on a ajouté des events", async () => {
    const path = await writeSession("aaaaaaaa-0000-4000-8000-000000000001", [
      { type: "ai-title", aiTitle: "premier titre" },
    ]);

    const index = newIndex();
    await index.refresh();
    expect(index.list()[0]?.title).toBe("premier titre");

    await writeFile(
      path,
      line({ type: "ai-title", aiTitle: "premier titre" }) +
        line({ type: "ai-title", aiTitle: "titre courant" }),
      "utf8",
    );

    const report = await index.refresh();
    expect(report.reindexed).toBe(1);
    expect(index.list()[0]?.title).toBe("titre courant");
  });

  it("oublie un transcript supprimé", async () => {
    const path = await writeSession("aaaaaaaa-0000-4000-8000-000000000001", [{ type: "user" }]);
    const index = newIndex();
    await index.refresh();
    expect(index.size).toBe(1);

    await rm(path);
    const report = await index.refresh();
    expect(report.dropped).toBe(1);
    expect(index.list()).toHaveLength(0);
  });

  it("survit à un index corrompu en repartant de zéro", async () => {
    await writeSession("aaaaaaaa-0000-4000-8000-000000000001", [{ type: "user" }]);
    await writeFile(indexFile, "{ ceci n'est pas du json", "utf8");

    const index = newIndex();
    await index.load();
    expect(index.size).toBe(0);

    await index.refresh();
    expect(index.size).toBe(1);
  });

  it("sépare les sous-agents des sessions et les rattache", async () => {
    const sessionId = "aaaaaaaa-0000-4000-8000-000000000001";
    await writeSession(sessionId, [{ type: "user" }]);
    await writeSubagent(sessionId, "abc123", [{ type: "agent-name", agentName: "relecture" }]);

    const index = newIndex();
    await index.refresh();

    expect(index.list()).toHaveLength(1);
    const [subagent] = index.subagents(sessionId);
    expect(subagent?.agentId).toBe("abc123");
  });

  it("suit la chaîne des sessions reprises", async () => {
    await writeSession("aaaaaaaa-0000-4000-8000-000000000001", [
      { type: "continued-in", continuedInSessionId: "aaaaaaaa-0000-4000-8000-000000000002" },
    ]);
    await writeSession("aaaaaaaa-0000-4000-8000-000000000002", [{ type: "user" }]);

    const index = newIndex();
    await index.refresh();

    const chain = index.chain("aaaaaaaa-0000-4000-8000-000000000001");
    expect(chain.map((s) => s.sessionId)).toEqual([
      "aaaaaaaa-0000-4000-8000-000000000001",
      "aaaaaaaa-0000-4000-8000-000000000002",
    ]);
  });

  it("ne boucle pas sur une chaîne circulaire", async () => {
    await writeSession("aaaaaaaa-0000-4000-8000-000000000001", [
      { type: "continued-in", continuedInSessionId: "aaaaaaaa-0000-4000-8000-000000000002" },
    ]);
    await writeSession("aaaaaaaa-0000-4000-8000-000000000002", [
      { type: "continued-in", continuedInSessionId: "aaaaaaaa-0000-4000-8000-000000000001" },
    ]);

    const index = newIndex();
    await index.refresh();
    expect(index.chain("aaaaaaaa-0000-4000-8000-000000000001")).toHaveLength(2);
  });

  it("range la session dans son worktree plutôt que dans son dossier d'origine", async () => {
    await writeSession("aaaaaaaa-0000-4000-8000-000000000001", [
      { type: "user", cwd: "C:\\Projets\\projet-a" },
      { type: "relocated", relocatedCwd: "C:\\Projets\\projet-a\\.claude\\worktrees\\wt" },
    ]);

    const index = newIndex();
    await index.refresh();
    expect(index.list()[0]?.effectiveCwd).toBe("C:\\Projets\\projet-a\\.claude\\worktrees\\wt");
  });
});
