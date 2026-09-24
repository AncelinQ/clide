import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SettingsEditor } from "../src/settings/editor.js";

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "clide-settings-"));
  file = join(dir, "settings.json");
  await writeFile(file, '{\n  "model": "opus"\n}\n', "utf8");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 3 });
});

describe("écritures simultanées", () => {
  it("n'en perd aucune quand plusieurs éditions partent en même temps", async () => {
    // Deux éditeurs distincts, comme deux requêtes du serveur.
    const keys = ["language", "effortLevel", "tui", "autoUpdatesChannel", "cleanupPeriodDays"];
    await Promise.all(
      keys.map((key, index) => new SettingsEditor().update(file, [{ path: [key], value: `valeur-${index}` }])),
    );

    const written = JSON.parse(await readFile(file, "utf8")) as Record<string, string>;
    for (const [index, key] of keys.entries()) expect(written[key]).toBe(`valeur-${index}`);
    expect(written["model"]).toBe("opus");
  });

  it("ne laisse aucun fichier temporaire derrière elles", async () => {
    await Promise.all(
      [1, 2, 3].map((n) => new SettingsEditor().update(file, [{ path: [`k${n}`], value: n }])),
    );
    const names = await readdir(dir);
    expect(names.filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("continue après une édition refusée", async () => {
    await writeFile(file, "{ pas du json", "utf8");
    await expect(new SettingsEditor().update(file, [{ path: ["a"], value: 1 }])).rejects.toThrow();
    await writeFile(file, "{}\n", "utf8");
    await new SettingsEditor().update(file, [{ path: ["a"], value: 1 }]);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ a: 1 });
  });
});
