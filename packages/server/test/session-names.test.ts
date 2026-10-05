import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SessionNames } from "../src/sessions/names.js";

let directory: string;
let file: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "clide-names-"));
  file = join(directory, "data", "session-names.json");
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true, maxRetries: 3 });
});

describe("SessionNames", () => {
  it("retient le nom d'une session d'un démarrage à l'autre, et l'oublie sans nom", async () => {
    const names = new SessionNames(file);
    await names.load();
    names.set("s1", "revue");
    names.set("s2", "front");
    names.set("s2", undefined);
    await names.flush();
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ s1: "revue" });

    const again = new SessionNames(file);
    await again.load();
    expect(again.get("s1")).toBe("revue");
    expect(again.get("s2")).toBeUndefined();
  });

  it("donne le nom d'un onglet nommé à sa session, et celui de la session à un onglet sans nom", async () => {
    const names = new SessionNames(file);
    await names.load();
    expect(names.match("s1", "revue")).toBeUndefined();
    expect(names.get("s1")).toBe("revue");
    expect(names.match("s1", undefined)).toBe("revue");
    // Un onglet déjà nommé garde le sien, et la session le prend.
    expect(names.match("s1", "autre")).toBeUndefined();
    expect(names.get("s1")).toBe("autre");
    expect(names.match("inconnue", undefined)).toBeUndefined();
  });

  it("part sans nom d'un fichier absent, illisible ou mal formé", async () => {
    const absent = new SessionNames(file);
    await absent.load();
    expect(absent.get("s1")).toBeUndefined();

    const broken = join(directory, "broken.json");
    await writeFile(broken, "{", "utf8");
    const unreadable = new SessionNames(broken);
    await unreadable.load();
    expect(unreadable.get("s1")).toBeUndefined();

    const mixed = join(directory, "mixed.json");
    await writeFile(mixed, JSON.stringify({ s1: "revue", s2: 3, s3: "" }), "utf8");
    const kept = new SessionNames(mixed);
    await kept.load();
    expect([kept.get("s1"), kept.get("s2"), kept.get("s3")]).toEqual(["revue", undefined, undefined]);
  });
});
