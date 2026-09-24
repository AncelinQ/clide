import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LinkStore } from "../src/links/store.js";
import { appDataDir, legacyAppDataDir, migrateAppData } from "../src/paths.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "clide-migration-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const exists = async (path: string) => !!(await stat(path).catch(() => undefined));

describe("migrateAppData", () => {
  it("déplace le dossier de l'ancien nom vers le nouveau, une seule fois", async () => {
    const env = { LOCALAPPDATA: dir };
    await mkdir(join(legacyAppDataDir(env), "diagrams"), { recursive: true });
    await writeFile(join(legacyAppDataDir(env), "session-index.json"), "{}");

    expect((await migrateAppData(env)).moved.sort()).toEqual(["diagrams", "session-index.json"]);
    expect(await readFile(join(appDataDir(env), "session-index.json"), "utf8")).toBe("{}");
    expect(await exists(legacyAppDataDir(env))).toBe(false);
    expect((await migrateAppData(env)).moved).toEqual([]);
  });

  it("reprend ce qui manque au nouveau dossier sans écraser ce qu'il a déjà", async () => {
    const env = { LOCALAPPDATA: dir };
    await mkdir(join(legacyAppDataDir(env), "diagrams"), { recursive: true });
    await writeFile(join(legacyAppDataDir(env), "diagrams", "a.json"), "ancien");
    await writeFile(join(legacyAppDataDir(env), "session-index.json"), "ancien");
    await mkdir(join(appDataDir(env), "diagrams"), { recursive: true });
    await writeFile(join(appDataDir(env), "diagrams", "b.json"), "neuf");

    expect(await migrateAppData(env)).toMatchObject({ moved: ["session-index.json"], kept: ["diagrams"] });
    expect(await readFile(join(appDataDir(env), "diagrams", "b.json"), "utf8")).toBe("neuf");
    expect(await readFile(join(appDataDir(env), "session-index.json"), "utf8")).toBe("ancien");
    // Ce qui n'a pas pu suivre reste dans l'ancien dossier, qui n'est donc pas retiré.
    expect(await exists(join(legacyAppDataDir(env), "diagrams", "a.json"))).toBe(true);
  });

  it("abandonne l'ancienne copie de ce que l'application recrée à chaque lancement", async () => {
    const env = { LOCALAPPDATA: dir };
    await mkdir(join(legacyAppDataDir(env), "pwsh"), { recursive: true });
    await writeFile(join(legacyAppDataDir(env), "pwsh", "claude-ide-profile.ps1"), "ancien profil");
    await mkdir(join(appDataDir(env), "pwsh"), { recursive: true });

    expect(await migrateAppData(env)).toMatchObject({ moved: [], kept: [] });
    expect(await exists(legacyAppDataDir(env))).toBe(false);
  });
});

describe("LinkStore, fichiers de l'ancien nom", () => {
  it("lit les rôles de l'ancien fichier, puis le renomme et retire l'ancien prompt à la première écriture", async () => {
    const linked = join(dir, "api");
    await mkdir(linked, { recursive: true });
    await mkdir(join(dir, ".claude"), { recursive: true });
    await writeFile(
      join(dir, ".claude", "settings.local.json"),
      JSON.stringify({ permissions: { additionalDirectories: [linked] } }),
    );
    await writeFile(join(dir, ".claude", "claude-ide.json"), JSON.stringify({ roles: { [linked]: "le back" } }));
    await writeFile(join(dir, ".claude", "claude-ide-prompt.md"), "ancien prompt");

    const store = new LinkStore();
    expect((await store.read(dir))[0]?.role).toBe("le back");
    // Lire ne modifie pas le projet.
    expect(await exists(join(dir, ".claude", "claude-ide.json"))).toBe(true);

    await store.writePrompt(dir);
    expect(await exists(join(dir, ".claude", "claude-ide.json"))).toBe(false);
    expect(await exists(join(dir, ".claude", "claude-ide-prompt.md"))).toBe(false);
    expect(JSON.parse(await readFile(join(dir, ".claude", "clide.json"), "utf8")).roles[linked]).toBe("le back");
    expect(await readFile(join(dir, ".claude", "clide-prompt.md"), "utf8")).toContain("le back");
  });
});
