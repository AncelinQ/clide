import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LinkStore, denyRules, promptPath } from "../src/links/store.js";
import { MASK, McpStore, redactServer, restoreMasked } from "../src/mcp/store.js";
import { ScriptStore, parsePnpmWorkspace } from "../src/scripts/store.js";
import { SkillStore, parseFrontmatter } from "../src/skills/store.js";
import { SettingsEditor } from "../src/settings/editor.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "claude-ide-stores-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function write(relative: string, content: string): Promise<string> {
  const path = join(dir, relative);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content, "utf8");
  return path;
}

// ─── A5 · skills ────────────────────────────────────────────────────────────

describe("parseFrontmatter", () => {
  it("lit les paires clé/valeur de l'en-tête", () => {
    const { fields, body } = parseFrontmatter(
      "---\nname: commit\ndescription: Commit et MR\nuser-invocable: true\n---\n\n# Titre\n",
    );
    expect(fields["name"]).toBe("commit");
    expect(fields["description"]).toBe("Commit et MR");
    expect(body.trim()).toBe("# Titre");
  });

  it("retire les guillemets autour d'une valeur", () => {
    expect(parseFrontmatter('---\nname: "mon skill"\n---\n').fields["name"]).toBe("mon skill");
  });

  it("rend le texte tel quel sans en-tête", () => {
    expect(parseFrontmatter("# Juste du markdown\n").fields).toEqual({});
  });

  it("ne confond pas un séparateur du corps avec la fin de l'en-tête", () => {
    const { fields, body } = parseFrontmatter("---\nname: x\n---\n\ntexte\n\n---\n\nsuite\n");
    expect(fields["name"]).toBe("x");
    expect(body).toContain("suite");
  });
});

describe("SkillStore", () => {
  it("liste les skills des plugins sous leur nom d'invocation, une seule fois par version", async () => {
    await write("home/plugins/cache/officiel/revue/1.0.0/skills/relire/SKILL.md", "---\nname: relire\ndescription: v1\n---\n");
    await write("home/plugins/cache/officiel/revue/1.1.0/skills/relire/SKILL.md", "---\nname: relire\ndescription: v1.1\n---\n");
    await write("home/plugins/cache/officiel/revue/1.1.0/node_modules/x/skills/piege/SKILL.md", "---\nname: piege\n---\n");
    await write("home/plugins/cache/officiel/outil/skills/lancer/SKILL.md", "---\nname: lancer\n---\n");

    const skills = await new SkillStore(join(dir, "home")).listPluginSkills();
    expect(skills.map((skill) => [skill.name, skill.scope, skill.plugin])).toEqual([
      ["outil:lancer", "plugin", "outil"],
      ["revue:relire", "plugin", "revue"],
    ]);
  });

  it("n'échoue pas sans plugin installé", async () => {
    expect(await new SkillStore(join(dir, "home")).listPluginSkills()).toEqual([]);
  });

  it("retient le nom du frontmatter, pas celui du dossier", async () => {
    await write(
      "home/skills/git/SKILL.md",
      "---\nname: commit\ndescription: conventions maison\n---\n",
    );
    const [skill] = await new SkillStore(join(dir, "home")).listUserSkills();

    expect(skill?.name).toBe("commit");
    expect(skill?.directory).toBe("git");
    expect(skill?.invocation).toBe("auto-and-slash");
  });

  it("distingue les trois modes d'invocation", async () => {
    await write("home/skills/a/SKILL.md", "---\nname: a\n---\n");
    await write("home/skills/b/SKILL.md", "---\nname: b\ndisable-model-invocation: true\n---\n");
    await write("home/skills/c/SKILL.md", "---\nname: c\nuser-invocable: false\n---\n");

    const skills = await new SkillStore(join(dir, "home")).listUserSkills();
    expect(skills.map((s) => [s.name, s.invocation])).toEqual([
      ["a", "auto-and-slash"],
      ["b", "manual-only"],
      ["c", "auto-only"],
    ]);
  });

  it("découpe la liste des outils autorisés", async () => {
    await write("home/skills/a/SKILL.md", "---\nname: a\nallowed-tools: Bash, Read,  Write\n---\n");
    const [skill] = await new SkillStore(join(dir, "home")).listUserSkills();
    expect(skill?.allowedTools).toEqual(["Bash", "Read", "Write"]);
  });

  it("nomme une commande imbriquée avec son espace de nom", async () => {
    await write("home/commands/sc/brainstorm.md", "# brainstorm\n");
    await write("home/commands/simple.md", "# simple\n");

    const commands = await new SkillStore(join(dir, "home")).listUserCommands();
    expect(commands.map((c) => c.name)).toEqual(["sc:brainstorm", "simple"]);
  });

  it("laisse un skill de projet masquer un skill personnel du même nom", async () => {
    await write("home/skills/git/SKILL.md", "---\nname: commit\ndescription: perso\n---\n");
    await write("projet/.claude/skills/commit/SKILL.md", "---\nname: commit\ndescription: projet\n---\n");

    const { skills } = await new SkillStore(join(dir, "home")).listAll(join(dir, "projet"));
    expect(skills).toHaveLength(1);
    expect(skills[0]?.scope).toBe("project");
    expect(skills[0]?.description).toBe("projet");
  });

  it("ignore un dossier sans SKILL.md", async () => {
    await mkdir(join(dir, "home", "skills", "vide"), { recursive: true });
    expect(await new SkillStore(join(dir, "home")).listUserSkills()).toEqual([]);
  });
});

// ─── A6 · MCP ───────────────────────────────────────────────────────────────

describe("McpStore", () => {
  const userConfig = (): string => join(dir, ".claude.json");

  it("lit les trois portées et les distingue", async () => {
    // La portée `project` se lit sur le disque, la portée `local` par une clé de
    // `~/.claude.json` : les deux doivent désigner le même dossier.
    const projectRoot = join(dir, "app");
    await write(
      ".claude.json",
      JSON.stringify({
        mcpServers: { linear: { type: "http", url: "https://mcp.linear.app/mcp" } },
        projects: {
          [projectRoot]: { mcpServers: { supabase: { command: "npx", args: ["-y", "supabase"] } } },
        },
      }),
    );
    await write("app/.mcp.json", JSON.stringify({ mcpServers: { equipe: { url: "https://x" } } }));

    const store = new McpStore(dir, userConfig());
    const all = await store.listAll(projectRoot);
    expect(all.map((s) => [s.name, s.scope])).toEqual([
      ["equipe", "project"],
      ["supabase", "local"],
      ["linear", "user"],
    ]);
  });

  it("reconnaît le transport même sans champ type", async () => {
    await write(
      ".claude.json",
      JSON.stringify({
        mcpServers: {
          web: { url: "https://x" },
          local: { command: "node", args: ["s.js"] },
        },
      }),
    );
    const servers = await new McpStore(dir, userConfig()).listUser();
    expect(servers.map((s) => [s.name, s.transport])).toEqual([
      ["local", "stdio"],
      ["web", "http"],
    ]);
  });

  it("compare les chemins de projet sans se laisser piéger par les séparateurs", async () => {
    await write(
      ".claude.json",
      JSON.stringify({ projects: { "C:/Projets/app": { mcpServers: { x: { url: "https://x" } } } } }),
    );
    const store = new McpStore(dir, userConfig());
    expect(await store.listLocal("C:\\Projets\\app")).toHaveLength(1);
    expect(await store.listLocal("C:\\Projets\\app\\")).toHaveLength(1);
  });

  it("masque les secrets par défaut et garde les clés", async () => {
    await write(
      ".claude.json",
      JSON.stringify({
        mcpServers: {
          github: { url: "https://api.github.com", headers: { Authorization: "Bearer valeur-sensible-de-test" } },
        },
      }),
    );
    const store = new McpStore(dir, userConfig());

    const [masked] = await store.listAll("C:/Projets/app");
    expect(masked?.headers).toEqual({ Authorization: MASK });
    expect(masked?.redacted).toBe(true);
    expect(JSON.stringify(masked)).not.toContain("valeur-sensible-de-test");

    const [revealed] = await store.listAll("C:/Projets/app", { reveal: true });
    expect(revealed?.headers?.["Authorization"]).toBe("Bearer valeur-sensible-de-test");
  });

  it("ne marque pas comme masqué un serveur sans secret", () => {
    const server = redactServer({ name: "x", scope: "user", transport: "http", redacted: false });
    expect(server.redacted).toBe(false);
  });

  it("rend une liste vide sur une configuration absente", async () => {
    const store = new McpStore(dir, join(dir, "nulle-part.json"));
    expect(await store.listAll(join(dir, "app"))).toEqual([]);
  });

  it("recopie un serveur d'un autre projet avec ses secrets, sans les exposer en liste", async () => {
    await write(
      "autre/.mcp.json",
      JSON.stringify({ mcpServers: { db: { command: "npx", args: ["db"], env: { TOKEN: "secret-de-test" } } } }),
    );
    await mkdir(join(dir, "app"), { recursive: true });
    const store = new McpStore(dir, userConfig());

    const [listed] = await store.library([join(dir, "autre"), join(dir, "app")], [join(dir, "app")]);
    expect(listed).toMatchObject({ name: "db", source: join(dir, "autre") });

    await store.copyToProject(join(dir, "app"), { scope: "project", root: join(dir, "autre"), name: "db" });
    const written = JSON.parse(await readFile(join(dir, "app", ".mcp.json"), "utf8"));
    expect(written.mcpServers.db.env.TOKEN).toBe("secret-de-test");
  });

  it("montre les serveurs des dossiers liés sous leur propre portée", async () => {
    await write("lib/.mcp.json", JSON.stringify({ mcpServers: { outil: { url: "https://x" } } }));
    const linked = await new McpStore(dir, userConfig()).listLinked([join(dir, "lib"), join(dir, "vide")]);
    expect(linked).toEqual([expect.objectContaining({ name: "outil", scope: "linked", source: join(dir, "lib") })]);
  });

  it("remet les secrets d'origine derrière les valeurs masquées d'une édition", () => {
    const edited = restoreMasked(
      { url: "https://nouvelle", headers: { Authorization: MASK, "X-Autre": "neuf" } },
      { url: "https://ancienne", headers: { Authorization: "Bearer vrai" } },
    );
    expect(edited).toEqual({ url: "https://nouvelle", headers: { Authorization: "Bearer vrai", "X-Autre": "neuf" } });
    expect(() => restoreMasked({ env: { CLE: MASK } }, undefined)).toThrow("valeur masquée");
  });
});

// ─── A8 · scripts ───────────────────────────────────────────────────────────

describe("parsePnpmWorkspace", () => {
  it("extrait la liste des paquets", () => {
    expect(parsePnpmWorkspace('packages:\n  - "packages/*"\n  - apps/web\n')).toEqual([
      "packages/*",
      "apps/web",
    ]);
  });

  it("s'arrête à la clé suivante", () => {
    expect(parsePnpmWorkspace('packages:\n  - "packages/*"\nallowBuilds:\n  esbuild: true\n')).toEqual([
      "packages/*",
    ]);
  });
});

describe("ScriptStore", () => {
  it("déduit le gestionnaire du lockfile", async () => {
    await write("projet/package.json", "{}");
    await write("projet/pnpm-lock.yaml", "");
    expect(await ScriptStore.detectManager(join(dir, "projet"))).toEqual({
      manager: "pnpm",
      detected: true,
    });
  });

  it("retombe sur npm en signalant que ce n'est pas une détection", async () => {
    await write("projet/package.json", "{}");
    expect(await ScriptStore.detectManager(join(dir, "projet"))).toEqual({
      manager: "npm",
      detected: false,
    });
  });

  it("collecte les scripts de la racine et des espaces de travail", async () => {
    await write(
      "projet/package.json",
      JSON.stringify({ name: "racine", scripts: { build: "tsc" }, workspaces: ["packages/*"] }),
    );
    await write("projet/package-lock.json", "{}");
    await write("projet/packages/a/package.json", JSON.stringify({ name: "a", scripts: { test: "vitest" } }));
    await write("projet/packages/b/package.json", JSON.stringify({ name: "b", scripts: {} }));

    const result = await new ScriptStore().read(join(dir, "projet"));
    expect(result.manager).toBe("npm");
    expect(result.sources.map((s) => s.packageName)).toEqual(["racine", "a", "b"]);
    expect(result.sources[1]?.scripts).toEqual([{ name: "test", command: "vitest" }]);
  });

  it("ignore un dossier d'espace de travail sans package.json", async () => {
    await write("projet/package.json", JSON.stringify({ workspaces: ["packages/*"] }));
    await mkdir(join(dir, "projet", "packages", "vide"), { recursive: true });

    const result = await new ScriptStore().read(join(dir, "projet"));
    expect(result.sources).toHaveLength(1);
  });

  it("préfixe la commande selon le gestionnaire", () => {
    expect(ScriptStore.runCommand("npm", "build")).toBe("npm run build");
    expect(ScriptStore.runCommand("pnpm", "build")).toBe("pnpm run build");
  });
});

// ─── A9 · projets liés ──────────────────────────────────────────────────────

describe("LinkStore", () => {
  it("rend une règle de refus absolue", () => {
    // Claude Code ne confronte que les règles `Edit` aux écritures de fichiers,
    // et les signale quand elles visent un chemin sous une autre forme.
    expect(denyRules("C:\\Projets\\api")).toEqual(["Edit(//C:/Projets/api/**)"]);
  });

  it("retire une règle de refus qu'il n'écrit plus lui-même", async () => {
    const root = join(dir, "projet");
    await write(
      "projet/.claude/settings.local.json",
      JSON.stringify({
        permissions: {
          additionalDirectories: ["C:\\Projets\\api"],
          deny: ["Edit(//C:/Projets/api/**)", "Write(//C:/Projets/api/**)"],
        },
      }),
    );

    const store = new LinkStore();
    await store.write(root, [{ path: "C:\\Projets\\api", readOnly: true }]);

    const settings = await new SettingsEditor().read(join(root, ".claude", "settings.local.json"));
    const permissions = settings.value["permissions"] as Record<string, unknown>;
    expect(permissions["deny"]).toEqual(["Edit(//C:/Projets/api/**)"]);
  });

  it("écrit les chemins sans toucher aux permissions déjà accordées", async () => {
    const settings = join(dir, "projet", ".claude", "settings.local.json");
    await write(
      "projet/.claude/settings.local.json",
      JSON.stringify({ permissions: { allow: ["Bash(git status)", "Bash(ls)"] } }, null, 2),
    );

    await new LinkStore().write(join(dir, "projet"), [
      { path: "C:\\Projets\\api", role: "api", readOnly: false },
    ]);

    const after = await new SettingsEditor().read(settings);
    const permissions = after.value["permissions"] as Record<string, unknown>;
    expect(permissions["allow"]).toEqual(["Bash(git status)", "Bash(ls)"]);
    expect(permissions["additionalDirectories"]).toEqual(["C:\\Projets\\api"]);
  });

  it("pose et retire les règles de lecture seule", async () => {
    const root = join(dir, "projet");
    const store = new LinkStore();

    await store.write(root, [{ path: "C:\\Projets\\api", readOnly: true }]);
    let links = await store.read(root);
    expect(links[0]?.readOnly).toBe(true);

    await store.write(root, [{ path: "C:\\Projets\\api", readOnly: false }]);
    links = await store.read(root);
    expect(links[0]?.readOnly).toBe(false);
  });

  it("ne supprime pas une règle de refus qu'il n'a pas posée", async () => {
    const root = join(dir, "projet");
    await write(
      "projet/.claude/settings.local.json",
      JSON.stringify({ permissions: { deny: ["Bash(rm -rf /)"] } }, null, 2),
    );

    const store = new LinkStore();
    await store.write(root, [{ path: "C:\\Projets\\api", readOnly: true }]);
    await store.write(root, []);

    const settings = await new SettingsEditor().read(
      join(root, ".claude", "settings.local.json"),
    );
    const permissions = settings.value["permissions"] as Record<string, unknown>;
    expect(permissions["deny"]).toEqual(["Bash(rm -rf /)"]);
  });

  it("relit les rôles qu'il a écrits", async () => {
    const root = join(dir, "projet");
    const store = new LinkStore();
    await store.write(root, [
      { path: "C:\\Projets\\api", role: "api", readOnly: false },
      { path: "C:\\Projets\\ds", role: "design system", readOnly: true },
    ]);

    const links = await store.read(root);
    expect(links.map((l) => [l.path, l.role, l.readOnly])).toEqual([
      ["C:\\Projets\\api", "api", false],
      ["C:\\Projets\\ds", "design system", true],
    ]);
  });

  it("ne produit aucun texte quand il n'y a rien à dire", () => {
    expect(LinkStore.describe([])).toBe("");
    const text = LinkStore.describe([{ path: "C:\\api", role: "api", readOnly: true }]);
    expect(text).toContain("C:\\api");
    expect(text).toContain("api");
    expect(text).toContain("lecture seule");
  });

  it("écrit un fichier de prompt portant les chemins et les rôles", async () => {
    const root = join(dir, "projet");
    const store = new LinkStore();

    await store.write(root, [
      { path: "C:\\Projets\\api", role: "api", readOnly: false },
      { path: "C:\\Projets\\ds", role: "design system", readOnly: true },
    ]);

    const text = await readFile(promptPath(root), "utf8");
    expect(text).toContain("C:\\Projets\\api");
    expect(text).toContain("design system");
    expect(text).toContain("lecture seule");
  });

  it("retire le fichier de prompt avec le dernier lien", async () => {
    const root = join(dir, "projet");
    const store = new LinkStore();

    await store.write(root, [{ path: "C:\\Projets\\api", readOnly: false }]);
    expect(existsSync(promptPath(root))).toBe(true);

    // Un fichier laissé là décrirait un dossier dont le projet ne dépend plus.
    await store.write(root, []);
    expect(existsSync(promptPath(root))).toBe(false);
  });

  it("ne crée rien pour un projet sans lien", async () => {
    const root = join(dir, "vierge");
    await mkdir(root, { recursive: true });

    await new LinkStore().writePrompt(root);

    expect(existsSync(join(root, ".claude"))).toBe(false);
  });
});
