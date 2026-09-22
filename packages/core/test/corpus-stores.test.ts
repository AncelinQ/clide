import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { claudeHome } from "../src/paths.js";
import { MASK, McpStore } from "../src/mcp/store.js";
import { ScriptStore } from "../src/scripts/store.js";
import { SkillStore } from "../src/skills/store.js";

/**
 * Critères d'acceptation A5, A6 et A8 sur la configuration réelle de la machine.
 * Ignorés là où il n'y a pas de `~/.claude`.
 */
const HOME = claudeHome();
const hasHome = existsSync(HOME);
const PROJECTS_ROOT = "C:\\Projets";
const hasProjects = existsSync(PROJECTS_ROOT);

describe.skipIf(!hasHome)("A5 — skills et commandes réels", () => {
  it("inventorie les skills et commandes personnels", async () => {
    const store = new SkillStore(HOME);
    const [skills, commands] = await Promise.all([store.listUserSkills(), store.listUserCommands()]);

    console.log(
      JSON.stringify(
        {
          skills: skills.map((s) => ({ nom: s.name, dossier: s.directory, invocation: s.invocation })),
          commandes: commands.length,
          exemplesCommandes: commands.slice(0, 4).map((c) => c.name),
        },
        null,
        2,
      ),
    );

    expect(commands.length).toBeGreaterThan(0);
    // Une commande imbriquée doit être nommée avec son espace de nom.
    expect(commands.some((command) => command.name.includes(":"))).toBe(true);
    for (const skill of skills) expect(skill.name.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!hasHome)("A6 — serveurs MCP réels", () => {
  it("liste les serveurs des trois portées sans laisser fuir de secret", async () => {
    const store = new McpStore(HOME);
    const masked = await store.listAll(PROJECTS_ROOT);
    const revealed = await store.listAll(PROJECTS_ROOT, { reveal: true });

    console.log(
      JSON.stringify(
        {
          serveurs: masked.map((s) => ({ nom: s.name, portee: s.scope, transport: s.transport })),
          masques: masked.filter((s) => s.redacted).map((s) => s.name),
        },
        null,
        2,
      ),
    );

    expect(masked.length).toBeGreaterThan(0);

    // Toute valeur d'en-tête ou d'environnement présente en clair dans la version
    // révélée doit être absente de la version masquée.
    const serialized = JSON.stringify(masked);
    for (const server of revealed) {
      for (const value of [...Object.values(server.headers ?? {}), ...Object.values(server.env ?? {})]) {
        if (value.length < 8) continue;
        expect(serialized).not.toContain(value);
      }
    }
    for (const server of masked) {
      for (const value of Object.values(server.headers ?? {})) expect(value).toBe(MASK);
    }
  });
});

describe.skipIf(!hasProjects)("A8 — scripts des projets réels", () => {
  it("déduit le gestionnaire de chaque projet depuis son lockfile", async () => {
    const entries = await readdir(PROJECTS_ROOT, { withFileTypes: true });
    const store = new ScriptStore();
    const report: { projet: string; manager: string; detecte: boolean; scripts: number }[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const root = join(PROJECTS_ROOT, entry.name);
      if (!existsSync(join(root, "package.json"))) continue;

      const result = await store.read(root);
      report.push({
        projet: entry.name,
        manager: result.manager,
        detecte: result.managerDetected,
        scripts: result.sources.reduce((total, source) => total + source.scripts.length, 0),
      });
    }

    console.log(JSON.stringify(report, null, 2));

    expect(report.length).toBeGreaterThan(0);
    // Le gestionnaire n'est jamais inventé : soit un lockfile l'a donné, soit
    // le défaut est explicitement signalé comme tel.
    for (const row of report) {
      expect(["pnpm", "npm", "yarn", "bun"]).toContain(row.manager);
      if (!row.detecte) expect(row.manager).toBe("npm");
    }
    // Ce test parcourt tous les projets du disque : son coût dépend de la
    // charge de la machine, pas de la logique qu'il vérifie.
  }, 60_000);
});
