import { readFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";

import { KNOWN_EVENT_TYPES } from "../src/transcript/events.js";
import { parseLine } from "../src/transcript/jsonl.js";
import { projectEvents } from "../src/session/projection.js";
import { readTranscript } from "../src/transcript/reader.js";

const FIXTURES = join(import.meta.dirname, "fixtures");

interface EventsByType {
  [type: string]: Record<string, unknown>[];
}

async function loadByType(): Promise<EventsByType> {
  return JSON.parse(await readFile(join(FIXTURES, "events-by-type.json"), "utf8")) as EventsByType;
}

describe("fixtures", () => {
  it("couvre tous les types connus", async () => {
    const byType = await loadByType();
    expect(Object.keys(byType).sort()).toEqual([...KNOWN_EVENT_TYPES].sort());
  });

  it("ne porte aucun identifiant de la machine qui les a produites", async () => {
    const raw = (await readFile(join(FIXTURES, "events-by-type.json"), "utf8")).toLowerCase();

    // Les identifiants sont lus sur la machine plutôt qu'écrits en dur : la
    // vérification suit celui qui régénère les fixtures, et le dépôt ne porte
    // le nom de personne.
    for (const identifier of [userInfo().username, basename(homedir())]) {
      if (identifier.length < 3) continue;
      expect(raw).not.toContain(identifier.toLowerCase());
    }
  });

  it("ne porte aucune adresse réelle", async () => {
    const raw = await readFile(join(FIXTURES, "events-by-type.json"), "utf8");
    const hosts = [...raw.matchAll(/https?:\/\/([^/"\s]+)/g)].map((match) => match[1]);
    // `exemple.invalid` est le domaine que pose l'anonymiseur. Tout autre hôte
    // signifie qu'une URL réelle est passée au travers.
    for (const host of hosts) expect(host).toBe("exemple.invalid");
  });

  it("conserve la forme relative des chemins suivis", async () => {
    const byType = await loadByType();
    const delta = byType["file-history-delta"]?.[0];
    expect(typeof delta?.["trackingPath"]).toBe("string");
    expect(delta?.["trackingPath"] as string).not.toMatch(/^[A-Za-z]:/);
  });

  it("se rejoue en session complète sans anomalie", async () => {
    const { projection, stats } = await readTranscript(
      join(FIXTURES, "session.jsonl"),
      "fixture-session",
    );

    expect(stats.malformed).toBe(0);
    expect(stats.events).toBe(KNOWN_EVENT_TYPES.length);
    expect(projection.unknownTypes).toEqual({});
    expect(projection.title).toBeDefined();
    expect(projection.relocatedCwd).toBeDefined();
    expect(projection.files.length).toBeGreaterThan(0);
    expect(projection.prLinks.length).toBeGreaterThan(0);
  });

  it("porte au moins un fichier créé, cas majoritaire du corpus", async () => {
    const { projection } = await readTranscript(
      join(FIXTURES, "session.jsonl"),
      "fixture-session",
    );
    expect(projection.files.some((f) => f.created)).toBe(true);
  });

  it("projette chaque type isolément sans lever", async () => {
    const byType = await loadByType();
    for (const [type, samples] of Object.entries(byType)) {
      for (const sample of samples) {
        const parsed = parseLine(JSON.stringify(sample));
        expect(parsed.kind, `type ${type} illisible`).toBe("event");
        if (parsed.kind !== "event") continue;
        expect(() => projectEvents("x", [parsed.event])).not.toThrow();
      }
    }
  });
});
