import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { encodeProjectPath } from "@clide/core";

import { LiveSessions, type LiveSession } from "../src/sessions/live.js";

const CWD = String.raw`C:\Projets\app`;
let home: string;
let directory: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "clide-live-"));
  directory = join(home, "projects", encodeProjectPath(CWD));
  await mkdir(directory, { recursive: true });
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 3 });
});

const line = (event: Record<string, unknown>): string => `${JSON.stringify(event)}\n`;

describe("LiveSessions", () => {
  it("rattache l'onglet à la session créée après lui, et ne prévient qu'aux changements", async () => {
    const live = new LiveSessions(home);
    const received: LiveSession[] = [];
    live.on((_terminalId, session) => received.push(session));
    live.track("t1", CWD);

    const path = join(directory, "abc.jsonl");
    await writeFile(path, line({ type: "permission-mode", permissionMode: "plan" }), "utf8");
    await live.tick();
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ sessionId: "abc", planMode: true });

    // Rien d'écrit depuis : pas de nouvel envoi.
    await live.tick();
    expect(received).toHaveLength(1);

    await appendFile(
      path,
      line({ type: "assistant", message: { id: "m1", usage: { input_tokens: 1, output_tokens: 9 } } }),
      "utf8",
    );
    await live.tick();
    expect(received).toHaveLength(2);
    expect(received[1]?.tokens?.output).toBe(9);
    expect(live.current()).toEqual([{ terminalId: "t1", session: received[1] }]);
  });

  it("suit la session que désigne un hook plutôt que celle trouvée par date", async () => {
    const live = new LiveSessions(home);
    const received: LiveSession[] = [];
    live.on((_terminalId, session) => received.push(session));
    live.track("t1", CWD);

    await writeFile(join(directory, "devinee.jsonl"), line({ type: "ai-title", aiTitle: "devinée" }), "utf8");
    await live.tick();
    expect(received.at(-1)?.sessionId).toBe("devinee");

    const exact = join(directory, "exacte.jsonl");
    await writeFile(exact, line({ type: "ai-title", aiTitle: "exacte" }), "utf8");
    live.bind("t1", exact, "exacte");
    await live.tick();
    expect(received.at(-1)).toMatchObject({ sessionId: "exacte", title: "exacte" });
  });

  it("sert l'onglet le plus récent en premier : le transcript créé après lui est le sien", async () => {
    const live = new LiveSessions(home);
    const bound: string[] = [];
    live.on((terminalId) => bound.push(terminalId));
    live.track("ancien", CWD, undefined, Date.now() - 60_000);
    live.track("recent", CWD, undefined, Date.now() - 1);

    await writeFile(join(directory, "neuve.jsonl"), line({ type: "permission-mode", permissionMode: "default" }), "utf8");
    await live.tick();
    expect(bound).toEqual(["recent"]);
  });

  it("ne rattache pas deux onglets du même dossier à la même session", async () => {
    const live = new LiveSessions(home);
    const received: [string, LiveSession][] = [];
    live.on((terminalId, session) => received.push([terminalId, session]));
    live.track("t1", CWD);
    live.track("t2", CWD);

    await writeFile(join(directory, "seule.jsonl"), line({ type: "mode", mode: "normal" }), "utf8");
    await live.tick();
    // Lequel des deux le prend dépend de leur ordre d'ouverture, testé à part.
    expect(received).toHaveLength(1);
  });

  it("montre le modèle et l'effort du lancement tant que le transcript ne dit pas les siens", async () => {
    await writeFile(join(home, "settings.json"), JSON.stringify({ model: "claude-opus-5-5", effortLevel: "xhigh" }), "utf8");
    const live = new LiveSessions(home);
    const received: LiveSession[] = [];
    live.on((_terminalId, session) => received.push(session));
    live.track("t1", CWD, "claude --model claude-fable-5-1");

    const path = join(directory, "abc.jsonl");
    await writeFile(path, line({ type: "permission-mode", permissionMode: "default" }), "utf8");
    await live.tick();
    expect(received.at(-1)).toMatchObject({ model: "claude-fable-5-1", effort: "xhigh" });

    await appendFile(
      path,
      line({ type: "assistant", effort: "low", message: { id: "m1", model: "claude-sonnet-5-5", usage: { input_tokens: 1, output_tokens: 1 } } }),
      "utf8",
    );
    await live.tick();
    expect(received.at(-1)).toMatchObject({ model: "claude-sonnet-5-5", effort: "low" });
  });

  it("ne montre pas le mode d'une séance précédente tant que la reprise n'a rien écrit", async () => {
    const id = "0350d6a5-5bec-4df4-ba51-45df51df60f7";
    const path = join(directory, `${id}.jsonl`);
    await writeFile(
      path,
      line({ type: "user", permissionMode: "plan", timestamp: "2026-09-01T10:00:00.000Z" }),
      "utf8",
    );
    const live = new LiveSessions(home);
    const received: LiveSession[] = [];
    live.on((_terminalId, session) => received.push(session));
    live.track("t1", CWD, `claude --resume ${id}`);

    await live.tick();
    expect(received.at(-1)?.sessionId).toBe(id);
    expect(received.at(-1)?.planMode).toBeUndefined();

    await appendFile(path, line({ type: "user", permissionMode: "auto", timestamp: new Date().toISOString() }), "utf8");
    await live.tick();
    expect(received.at(-1)).toMatchObject({ permissionMode: "auto", planMode: false });
  });
});
