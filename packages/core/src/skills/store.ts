import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";

import { claudeHome } from "../paths.js";

/**
 * Comment un skill peut être déclenché.
 * - `auto-and-slash` : Claude le charge seul, et `/nom` le force.
 * - `manual-only`    : seulement `/nom` (`disable-model-invocation: true`).
 * - `auto-only`      : seulement le chargement automatique (`user-invocable: false`).
 */
export type SkillInvocation = "auto-and-slash" | "manual-only" | "auto-only";

export type Scope = "user" | "project";

export interface Skill {
  /** Nom déclaré dans le frontmatter, qui peut différer du nom du dossier. */
  name: string;
  directory: string;
  description?: string;
  invocation: SkillInvocation;
  allowedTools?: string[];
  scope: Scope;
  path: string;
}

export interface SlashCommand {
  /** `sc:brainstorm` pour `commands/sc/brainstorm.md`. */
  name: string;
  scope: Scope;
  path: string;
  description?: string;
}

export interface Frontmatter {
  fields: Record<string, string>;
  body: string;
}

/**
 * Lit l'en-tête d'un `SKILL.md`.
 *
 * Volontairement limité au sous-ensemble qu'utilisent les skills — des paires
 * `clé: valeur` sur une ligne — plutôt que de tirer un analyseur YAML complet
 * pour un en-tête de cinq lignes. Une valeur sur plusieurs lignes n'est pas
 * reconnue et reste dans le corps.
 */
export function parseFrontmatter(text: string): Frontmatter {
  const normalized = text.replace(/^﻿/, "");
  if (!normalized.startsWith("---")) return { fields: {}, body: normalized };

  const end = normalized.indexOf("\n---", 3);
  if (end === -1) return { fields: {}, body: normalized };

  const header = normalized.slice(normalized.indexOf("\n") + 1, end);
  const body = normalized.slice(normalized.indexOf("\n", end + 1) + 1);

  const fields: Record<string, string> = {};
  for (const line of header.split("\n")) {
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!match?.[1]) continue;
    const value = (match[2] ?? "").trim();
    fields[match[1]] = value.replace(/^["'](.*)["']$/, "$1");
  }
  return { fields, body };
}

function invocationOf(fields: Record<string, string>): SkillInvocation {
  if (fields["disable-model-invocation"] === "true") return "manual-only";
  if (fields["user-invocable"] === "false") return "auto-only";
  return "auto-and-slash";
}

function splitList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : undefined;
}

async function listDirectories(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function walkMarkdown(dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walkMarkdown(full, out);
    else if (entry.name.endsWith(".md")) out.push(full);
  }
}

/**
 * Inventaire des skills et des commandes, côté personnel comme côté projet.
 *
 * Un skill est un dossier `skills/<dossier>/SKILL.md`. Le `name` de son
 * frontmatter fait foi pour l'invocation : il ne suit pas nécessairement le nom
 * du dossier, et présenter le dossier induirait en erreur sur ce que `/nom` déclenche.
 */
export class SkillStore {
  readonly #home: string;

  constructor(home: string = claudeHome()) {
    this.#home = home;
  }

  async #readSkill(dir: string, directory: string, scope: Scope): Promise<Skill | undefined> {
    const path = join(dir, directory, "SKILL.md");
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch {
      return undefined;
    }
    const { fields } = parseFrontmatter(text);
    const description = fields["description"];
    const allowedTools = splitList(fields["allowed-tools"]);
    return {
      name: fields["name"] ?? directory,
      directory,
      ...(description ? { description } : {}),
      invocation: invocationOf(fields),
      ...(allowedTools ? { allowedTools } : {}),
      scope,
      path,
    };
  }

  async #listSkillsIn(dir: string, scope: Scope): Promise<Skill[]> {
    const directories = await listDirectories(dir);
    const skills: Skill[] = [];
    for (const directory of directories) {
      const skill = await this.#readSkill(dir, directory, scope);
      if (skill) skills.push(skill);
    }
    return skills.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Skills personnels, dans `~/.claude/skills`. */
  listUserSkills(): Promise<Skill[]> {
    return this.#listSkillsIn(join(this.#home, "skills"), "user");
  }

  /** Skills du projet, dans `<projet>/.claude/skills`. */
  listProjectSkills(projectRoot: string): Promise<Skill[]> {
    return this.#listSkillsIn(join(projectRoot, ".claude", "skills"), "project");
  }

  async #listCommandsIn(dir: string, scope: Scope): Promise<SlashCommand[]> {
    const files: string[] = [];
    await walkMarkdown(dir, files);
    const commands: SlashCommand[] = [];
    for (const path of files) {
      // Un fichier imbriqué devient une commande à espace de nom : `sc/build.md`
      // s'invoque `/sc:build`.
      const name = relative(dir, path)
        .replace(/\.md$/, "")
        .split(sep)
        .join(":");
      const { fields } = parseFrontmatter(await readFile(path, "utf8"));
      const description = fields["description"];
      commands.push({ name, scope, path, ...(description ? { description } : {}) });
    }
    return commands.sort((a, b) => a.name.localeCompare(b.name));
  }

  listUserCommands(): Promise<SlashCommand[]> {
    return this.#listCommandsIn(join(this.#home, "commands"), "user");
  }

  listProjectCommands(projectRoot: string): Promise<SlashCommand[]> {
    return this.#listCommandsIn(join(projectRoot, ".claude", "commands"), "project");
  }

  /**
   * Tout ce qui est invocable pour un projet. Un skill de projet qui porte le
   * même nom qu'un skill personnel masque ce dernier, comme le fait Claude Code.
   */
  async listAll(projectRoot: string): Promise<{ skills: Skill[]; commands: SlashCommand[] }> {
    const [userSkills, projectSkills, userCommands, projectCommands] = await Promise.all([
      this.listUserSkills(),
      this.listProjectSkills(projectRoot),
      this.listUserCommands(),
      this.listProjectCommands(projectRoot),
    ]);

    const shadowed = new Set(projectSkills.map((skill) => skill.name));
    const skills = [...projectSkills, ...userSkills.filter((skill) => !shadowed.has(skill.name))];

    const takenCommands = new Set(projectCommands.map((command) => command.name));
    const commands = [
      ...projectCommands,
      ...userCommands.filter((command) => !takenCommands.has(command.name)),
    ];

    return {
      skills: skills.sort((a, b) => a.name.localeCompare(b.name)),
      commands: commands.sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  static skillDirectory(skill: Skill): string {
    return basename(skill.path) === "SKILL.md" ? skill.path.slice(0, -"/SKILL.md".length) : skill.path;
  }
}
