import { existsSync } from "node:fs";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { settingsFile } from "../src/paths.js";
import { SettingsEditor, SettingsParseError } from "../src/settings/editor.js";

let dir: string;
let file: string;
let editor: SettingsEditor;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "clide-settings-"));
  file = join(dir, "settings.json");
  editor = new SettingsEditor();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const SAMPLE = `{
  "env": {
    "BRANCH_PREFIX": "aqn"
  },
  "model": "opus[1m]",
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "rtk hook claude" }]
      }
    ]
  }
}
`;

describe("SettingsEditor — édition pure", () => {
  it("ne touche qu'à l'étendue de texte visée", () => {
    const next = SettingsEditor.apply(SAMPLE, { path: ["model"], value: "sonnet" });

    expect(next).toContain('"model": "sonnet"');
    expect(next).toContain('"command": "rtk hook claude"');
    // Tout ce qui n'est pas la ligne du modèle est identique.
    const before = SAMPLE.split("\n").filter((line) => !line.includes('"model"'));
    const after = next.split("\n").filter((line) => !line.includes('"model"'));
    expect(after).toEqual(before);
  });

  it("crée une clé absente sans réindenter le reste", () => {
    const next = SettingsEditor.apply(SAMPLE, { path: ["env", "AUTRE"], value: "1" });
    expect(next).toContain('"BRANCH_PREFIX": "aqn"');
    expect(next).toContain('"AUTRE": "1"');
  });

  it("supprime une clé quand la valeur est undefined", () => {
    const next = SettingsEditor.apply(SAMPLE, { path: ["model"], value: undefined });
    expect(next).not.toContain('"model"');
    expect(next).toContain('"BRANCH_PREFIX"');
  });

  it("enchaîne plusieurs éditions", () => {
    const next = SettingsEditor.applyAll(SAMPLE, [
      { path: ["model"], value: "sonnet" },
      { path: ["env", "BRANCH_PREFIX"], value: "xyz" },
    ]);
    expect(next).toContain('"model": "sonnet"');
    expect(next).toContain('"BRANCH_PREFIX": "xyz"');
  });

  it("refuse un JSON illisible au lieu de deviner", () => {
    expect(() => SettingsEditor.parse("{ ceci n'est pas du json")).toThrow(SettingsParseError);
  });
});

describe("SettingsEditor — écriture", () => {
  it("n'écrit rien si le fichier existant est illisible", async () => {
    const broken = "{ cassé";
    await writeFile(file, broken, "utf8");

    await expect(editor.update(file, [{ path: ["model"], value: "sonnet" }])).rejects.toThrow(
      SettingsParseError,
    );
    expect(await readFile(file, "utf8")).toBe(broken);
  });

  it("sauvegarde le fichier avant sa première modification", async () => {
    await writeFile(file, SAMPLE, "utf8");
    await editor.update(file, [{ path: ["model"], value: "sonnet" }]);

    const backup = SettingsEditor.backupPath(file);
    expect(existsSync(backup)).toBe(true);
    expect(await readFile(backup, "utf8")).toBe(SAMPLE);
  });

  it("ne remplace pas une sauvegarde déjà en place", async () => {
    await writeFile(file, SAMPLE, "utf8");
    await editor.update(file, [{ path: ["model"], value: "sonnet" }]);
    await editor.update(file, [{ path: ["model"], value: "haiku" }]);

    // La sauvegarde doit rester l'état d'origine, pas l'avant-dernier.
    expect(await readFile(SettingsEditor.backupPath(file), "utf8")).toBe(SAMPLE);
  });

  it("traite un fichier absent comme un document vide", async () => {
    const result = await editor.update(file, [{ path: ["model"], value: "sonnet" }]);
    expect(result.value["model"]).toBe("sonnet");
    expect(await readFile(file, "utf8")).toContain('"model": "sonnet"');
  });

  it("ne laisse pas de fichier temporaire derrière lui", async () => {
    await writeFile(file, SAMPLE, "utf8");
    await editor.update(file, [{ path: ["model"], value: "sonnet" }]);
    expect(existsSync(`${file}.${process.pid}.tmp`)).toBe(false);
  });
});

/**
 * Point de contrôle G2 : la configuration réelle de la machine doit survivre
 * intacte à une modification par le formulaire. C'est le seul endroit du projet
 * où un défaut détruirait un réglage existant.
 */
const REAL = settingsFile();

describe.skipIf(!existsSync(REAL))("G2 — settings.json réel", () => {
  it("préserve les hooks au caractère près", async () => {
    const copy = join(dir, "settings.json");
    await copyFile(REAL, copy);
    const original = await readFile(copy, "utf8");

    await editor.update(copy, [{ path: ["model"], value: "modele-de-test" }]);
    const modified = await readFile(copy, "utf8");

    const originalLines = original.split("\n");
    const modifiedLines = modified.split("\n");

    const changed = modifiedLines.filter((line, i) => line !== originalLines[i]);
    console.log(
      JSON.stringify(
        {
          lignesAvant: originalLines.length,
          lignesApres: modifiedLines.length,
          lignesModifiees: changed.length,
          modifiees: changed,
        },
        null,
        2,
      ),
    );

    // Une seule ligne bouge, et c'est celle du modèle.
    expect(modifiedLines).toHaveLength(originalLines.length);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toContain("modele-de-test");

    // Les hooks sont identiques, bloc par bloc.
    const hooksOf = (text: string): string =>
      JSON.stringify((SettingsEditor.parse(text) as { hooks?: unknown }).hooks ?? null);
    expect(hooksOf(modified)).toBe(hooksOf(original));
  });
});
