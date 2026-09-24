import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { McpStore, safeServerName } from "../src/mcp/store.js";
import { SettingsEditor, SettingsParseError } from "../src/settings/editor.js";
import { SkillStore, renderSkill, safeDirectoryName } from "../src/skills/store.js";

let dir: string;
let home: string;
let project: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "clide-writes-"));
  home = join(dir, ".claude");
  project = join(dir, "projet");
  await mkdir(home, { recursive: true });
  await mkdir(project, { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 3 });
});

describe("safeDirectoryName", () => {
  it("refuse ce qui sortirait du dossier des skills", () => {
    // Ce nom compose un chemin qu'on supprime récursivement : un séparateur ou
    // un `..` suffirait à viser autre chose.
    for (const name of ["..", ".", "a/b", "a\\b", "a:b", "a*b", "  "]) {
      expect(() => safeDirectoryName(name)).toThrow();
    }
  });

  it("accepte un nom ordinaire et le débarrasse de ses espaces", () => {
    expect(safeDirectoryName("  revue-de-code  ")).toBe("revue-de-code");
  });
});

describe("renderSkill", () => {
  it("écrit l'en-tête et laisse le corps intact", () => {
    const text = renderSkill({
      scope: "user",
      directory: "git",
      name: "commit",
      description: "Commit et MR",
      body: "# Titre\n\n  du texte    indenté\n",
    });

    expect(text.startsWith("---\nname: commit\n")).toBe(true);
    expect(text).toContain("description: Commit et MR");
    expect(text).toContain("  du texte    indenté");
  });

  it("reprend le nom du dossier quand aucun n'est donné", () => {
    expect(renderSkill({ scope: "user", directory: "revue", body: "" })).toContain("name: revue");
  });

  it("aplatit une description multiligne, qui tiendrait mal dans l'en-tête", () => {
    const text = renderSkill({
      scope: "user",
      directory: "x",
      description: "une ligne\nune autre",
      body: "",
    });
    expect(text).toContain("description: une ligne une autre");
  });

  it("traduit les modes d'invocation en leurs clés", () => {
    expect(renderSkill({ scope: "user", directory: "x", invocation: "manual-only", body: "" })).toContain(
      "disable-model-invocation: true",
    );
    expect(renderSkill({ scope: "user", directory: "x", invocation: "auto-only", body: "" })).toContain(
      "user-invocable: false",
    );
    // Le mode par défaut ne s'écrit pas : une clé absente vaut mieux qu'une
    // clé redondante dans un fichier que l'auteur relit.
    const auto = renderSkill({ scope: "user", directory: "x", invocation: "auto-and-slash", body: "" });
    expect(auto).not.toContain("disable-model-invocation");
    expect(auto).not.toContain("user-invocable");
  });
});

describe("SkillStore — écriture", () => {
  it("crée un skill relisible par son propre lecteur", async () => {
    const store = new SkillStore(home);
    const saved = await store.save({
      scope: "user",
      directory: "revue",
      name: "revue-de-code",
      description: "Relit le diff courant",
      invocation: "manual-only",
      body: "# Revue\n\nÉtapes…\n",
    });

    expect(saved.name).toBe("revue-de-code");
    expect(saved.invocation).toBe("manual-only");

    const [listed] = await store.listUserSkills();
    expect(listed).toEqual(saved);
  });

  it("écrase un skill existant sans en créer un second", async () => {
    const store = new SkillStore(home);
    await store.save({ scope: "user", directory: "revue", description: "v1", body: "a" });
    await store.save({ scope: "user", directory: "revue", description: "v2", body: "b" });

    const skills = await store.listUserSkills();
    expect(skills).toHaveLength(1);
    expect(skills[0]?.description).toBe("v2");
  });

  it("écrit un skill de projet à sa place", async () => {
    const store = new SkillStore(home);
    await store.save({ scope: "project", directory: "local", body: "x", projectRoot: project });

    expect(existsSync(join(project, ".claude", "skills", "local", "SKILL.md"))).toBe(true);
    expect(await store.listUserSkills()).toEqual([]);
    expect(await store.listProjectSkills(project)).toHaveLength(1);
  });

  it("refuse un skill de projet sans racine de projet", async () => {
    await expect(new SkillStore(home).save({ scope: "project", directory: "x", body: "" })).rejects.toThrow(
      /racine du projet/,
    );
  });

  it("supprime un skill et rend faux sur un skill absent", async () => {
    const store = new SkillStore(home);
    await store.save({ scope: "user", directory: "revue", body: "x" });

    expect(await store.remove("user", "revue")).toBe(true);
    expect(await store.listUserSkills()).toEqual([]);
    expect(await store.remove("user", "revue")).toBe(false);
  });

  it("refuse de supprimer par un nom qui remonte l'arborescence", async () => {
    await expect(new SkillStore(home).remove("user", "../..")).rejects.toThrow();
  });
});

describe("McpStore — écriture de la portée projet", () => {
  const mcpFile = (): string => join(project, ".mcp.json");

  it("crée le fichier et y écrit le serveur", async () => {
    const store = new McpStore(home);
    const server = await store.saveProjectServer(project, "equipe", { type: "http", url: "https://x" });

    expect(server).toMatchObject({ name: "equipe", scope: "project", transport: "http" });
    expect(await store.listProject(project)).toHaveLength(1);
  });

  it("conserve les autres serveurs et le reste du fichier", async () => {
    await writeFile(
      mcpFile(),
      JSON.stringify({ mcpServers: { existant: { url: "https://a" } }, autreClé: 42 }, null, 2),
      "utf8",
    );

    const store = new McpStore(home);
    await store.saveProjectServer(project, "ajouté", { command: "node", args: ["s.js"] });

    const value = JSON.parse(await readFile(mcpFile(), "utf8"));
    expect(Object.keys(value.mcpServers).sort()).toEqual(["ajouté", "existant"]);
    expect(value.autreClé).toBe(42);
  });

  it("retire un serveur et signale celui qui n'existe pas", async () => {
    const store = new McpStore(home);
    await store.saveProjectServer(project, "equipe", { url: "https://x" });

    expect(await store.removeProjectServer(project, "equipe")).toBe(true);
    expect(await store.listProject(project)).toEqual([]);
    expect(await store.removeProjectServer(project, "equipe")).toBe(false);
  });

  it("refuse un nom qui désignerait une clé imbriquée", () => {
    // `a.b` deviendrait `mcpServers.a.b` dans l'arbre JSON, pas un serveur nommé « a.b ».
    expect(() => safeServerName("a.b")).toThrow();
    expect(() => safeServerName("  ")).toThrow();
    expect(safeServerName(" linear ")).toBe("linear");
  });
});

describe("SettingsEditor.replace", () => {
  const file = (): string => join(dir, "settings.json");

  it("écrit le texte tel quel, à l'octet près", async () => {
    const raw = '{\n  "model": "opus",\n\n  "env": { "A": "1" }\n}\n';
    const document = await new SettingsEditor().replace(file(), raw);

    expect(await readFile(file(), "utf8")).toBe(raw);
    expect(document.value["model"]).toBe("opus");
  });

  it("refuse un JSON invalide avant d'atteindre le disque", async () => {
    const valide = '{ "model": "opus" }';
    await writeFile(file(), valide, "utf8");

    await expect(new SettingsEditor().replace(file(), "{ cassé")).rejects.toThrow(SettingsParseError);
    expect(await readFile(file(), "utf8")).toBe(valide);
  });

  it("sauvegarde l'original avant de le remplacer", async () => {
    const origine = '{ "model": "opus" }';
    await writeFile(file(), origine, "utf8");
    await new SettingsEditor().replace(file(), '{ "model": "sonnet" }');

    expect(await readFile(SettingsEditor.backupPath(file()), "utf8")).toBe(origine);
  });
});
