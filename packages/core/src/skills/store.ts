import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, relative, sep } from "node:path";

import { claudeHome } from "../paths.js";

/**
 * Comment un skill peut être déclenché.
 * - `auto-and-slash` : Claude le charge seul, et `/nom` le force.
 * - `manual-only`    : seulement `/nom` (`disable-model-invocation: true`).
 * - `auto-only`      : seulement le chargement automatique (`user-invocable: false`).
 */
export type SkillInvocation = "auto-and-slash" | "manual-only" | "auto-only";

export type Scope = "user" | "project";

/** Portée d'un skill listé. Un skill de plugin se lit, il ne s'écrit pas : il appartient au plugin. */
export type SkillScope = Scope | "plugin";

export interface Skill {
  /** Nom déclaré dans le frontmatter, qui peut différer du nom du dossier. */
  name: string;
  directory: string;
  description?: string;
  invocation: SkillInvocation;
  allowedTools?: string[];
  scope: SkillScope;
  path: string;
  /** Plugin qui livre le skill. */
  plugin?: string;
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

/**
 * `SKILL.md` placés dans un dossier `skills/<nom>/`, cherchés sur quelques niveaux.
 *
 * Borné en profondeur : un plugin embarque parfois `node_modules`, qu'il n'y a
 * aucune raison de parcourir en entier.
 */
async function walkSkillFiles(dir: string, out: string[], depth: number): Promise<void> {
  if (depth > 6) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (basename(dir) === "skills") {
      try {
        await readFile(join(path, "SKILL.md"));
        out.push(join(path, "SKILL.md"));
      } catch {
        // Un dossier sous `skills/` sans SKILL.md n'est pas un skill.
      }
      continue;
    }
    await walkSkillFiles(path, out, depth + 1);
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

  async #readSkill(dir: string, directory: string, scope: SkillScope): Promise<Skill | undefined> {
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

  /**
   * Skills livrés par les plugins installés.
   *
   * Claude Code garde chaque plugin dans `plugins/cache/<marketplace>/<plugin>/`,
   * à une profondeur qui varie avec sa version ; le skill y est reconnu à sa
   * position `skills/<nom>/SKILL.md`. Il s'invoque `/<plugin>:<nom>`, d'où son nom
   * ici. Un même skill présent dans plusieurs versions n'est gardé qu'une fois.
   */
  async listPluginSkills(): Promise<Skill[]> {
    const cache = join(this.#home, "plugins", "cache");
    const files: string[] = [];
    await walkSkillFiles(cache, files, 0);

    const seen = new Set<string>();
    const skills: Skill[] = [];
    for (const path of files.sort()) {
      const parts = relative(cache, path).split(sep);
      const skillsIndex = parts.lastIndexOf("skills");
      const directory = parts[skillsIndex + 1];
      const plugin = parts[1];
      if (skillsIndex < 0 || !directory || !plugin) continue;
      const skill = await this.#readSkill(join(path, "..", ".."), directory, "plugin");
      if (!skill) continue;
      const name = `${plugin}:${skill.name}`;
      if (seen.has(name)) continue;
      seen.add(name);
      skills.push({ ...skill, name, plugin });
    }
    return skills.sort((a, b) => a.name.localeCompare(b.name));
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
    const [userSkills, projectSkills, userCommands, projectCommands, pluginSkills] = await Promise.all([
      this.listUserSkills(),
      this.listProjectSkills(projectRoot),
      this.listUserCommands(),
      this.listProjectCommands(projectRoot),
      this.listPluginSkills(),
    ]);

    const shadowed = new Set(projectSkills.map((skill) => skill.name));
    const skills = [
      ...projectSkills,
      ...userSkills.filter((skill) => !shadowed.has(skill.name)),
      // Préfixés du nom de leur plugin : ils ne masquent rien et rien ne les masque.
      ...pluginSkills,
    ];

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

  /** Racine des skills d'une portée. */
  #root(scope: Scope, projectRoot?: string): string {
    if (scope === "user") return join(this.#home, "skills");
    if (!projectRoot) throw new Error("un skill de projet demande la racine du projet");
    return join(projectRoot, ".claude", "skills");
  }

  /**
   * Contenu brut d'un skill.
   *
   * Résolu depuis la portée et le nom du dossier, jamais depuis un chemin fourni
   * par l'appelant : une route qui lirait un chemin arbitraire lirait n'importe
   * quel fichier de la machine.
   */
  async readRaw(scope: Scope, directory: string, projectRoot?: string): Promise<string> {
    const file = join(this.#root(scope, projectRoot), safeDirectoryName(directory), "SKILL.md");
    return readFile(file, "utf8");
  }

  /**
   * Écrit un skill, en le créant au besoin.
   *
   * Le corps est conservé tel quel ; seul l'en-tête est régénéré. Un skill est
   * d'abord un texte que son auteur relit, pas une structure de données — le
   * reformater à chaque enregistrement lui ferait perdre sa mise en forme.
   */
  async save(draft: SkillDraft): Promise<Skill> {
    const directory = safeDirectoryName(draft.directory);
    const folder = join(this.#root(draft.scope, draft.projectRoot), directory);
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "SKILL.md"), renderSkill(draft), "utf8");

    const skill = await this.#readSkill(this.#root(draft.scope, draft.projectRoot), directory, draft.scope);
    if (!skill) throw new Error(`skill ${directory} illisible après écriture`);
    return skill;
  }

  /**
   * Copie un skill d'une portée à l'autre, dossier compris : un skill porte
   * parfois des scripts ou des modèles à côté de son `SKILL.md`.
   *
   * Une copie ne remplace jamais un skill existant : écraser le travail de
   * l'autre portée sans le montrer serait une perte silencieuse.
   */
  async copy(
    from: { scope: Scope; directory: string; projectRoot?: string },
    to: { scope: Scope; projectRoot?: string },
  ): Promise<Skill> {
    const directory = safeDirectoryName(from.directory);
    const source = join(this.#root(from.scope, from.projectRoot), directory);
    const targetRoot = this.#root(to.scope, to.projectRoot);
    const target = join(targetRoot, directory);
    if (samePathLoose(source, target)) throw new Error("le skill est déjà à cet endroit");
    await this.#refuseExisting(target, directory);
    await mkdir(targetRoot, { recursive: true });
    await cp(source, target, { recursive: true, errorOnExist: true, force: false });
    return this.#mustRead(targetRoot, directory, to.scope);
  }

  /**
   * Importe un skill venu d'ailleurs : un dossier qui porte un `SKILL.md`, ou un
   * fichier `.md` seul, qui devient le `SKILL.md` d'un dossier à son nom.
   *
   * Rien d'autre n'est accepté : l'import lit un chemin donné par l'appelant, et
   * s'en tenir à ces deux formes l'empêche de recopier n'importe quel fichier.
   */
  async importPath(sourcePath: string, to: { scope: Scope; projectRoot?: string }): Promise<Skill> {
    const info = await stat(sourcePath);
    if (info.isDirectory()) {
      try {
        await stat(join(sourcePath, "SKILL.md"));
      } catch {
        throw new Error("ce dossier ne contient pas de SKILL.md");
      }
      const directory = safeDirectoryName(basename(sourcePath));
      const targetRoot = this.#root(to.scope, to.projectRoot);
      const target = join(targetRoot, directory);
      await this.#refuseExisting(target, directory);
      await mkdir(targetRoot, { recursive: true });
      await cp(sourcePath, target, { recursive: true, errorOnExist: true, force: false });
      return this.#mustRead(targetRoot, directory, to.scope);
    }
    if (extname(sourcePath).toLowerCase() !== ".md") throw new Error("seul un fichier .md ou un dossier de skill s'importe");
    const name = basename(sourcePath, extname(sourcePath));
    return this.importText(name === "SKILL" ? basename(join(sourcePath, "..")) : name, await readFile(sourcePath, "utf8"), to);
  }

  /**
   * Crée un skill depuis le texte d'un `.md`. Sans en-tête, il en reçoit un à son
   * nom : Claude Code ignore un `SKILL.md` qui n'en a pas.
   */
  async importText(name: string, text: string, to: { scope: Scope; projectRoot?: string }): Promise<Skill> {
    const directory = safeDirectoryName(name);
    const targetRoot = this.#root(to.scope, to.projectRoot);
    const target = join(targetRoot, directory);
    await this.#refuseExisting(target, directory);
    await mkdir(target, { recursive: true });
    const content = text.replace(/^\uFEFF/, "").trimStart().startsWith("---")
      ? text
      : renderSkill({ scope: to.scope, directory, body: text });
    await writeFile(join(target, "SKILL.md"), content, "utf8");
    return this.#mustRead(targetRoot, directory, to.scope);
  }

  async #refuseExisting(target: string, directory: string): Promise<void> {
    try {
      await stat(target);
    } catch {
      return;
    }
    throw new Error(`un skill « ${directory} » existe déjà à cet endroit`);
  }

  async #mustRead(root: string, directory: string, scope: Scope): Promise<Skill> {
    const skill = await this.#readSkill(root, directory, scope);
    if (!skill) throw new Error(`skill ${directory} illisible après écriture`);
    return skill;
  }

  /**
   * Supprime un skill, dossier compris.
   *
   * Le nom est validé avant toute chose : c'est une suppression récursive, et un
   * nom porteur de séparateurs la ferait sortir du dossier des skills.
   */
  async remove(scope: Scope, directory: string, projectRoot?: string): Promise<boolean> {
    const folder = join(this.#root(scope, projectRoot), safeDirectoryName(directory));
    try {
      await rm(folder, { recursive: true, force: false });
      return true;
    } catch {
      return false;
    }
  }
}

export interface SkillDraft {
  scope: Scope;
  /** Nom du dossier qui portera le skill. */
  directory: string;
  /** Nom déclaré, celui qui déclenche `/nom`. Par défaut, celui du dossier. */
  name?: string;
  description?: string;
  invocation?: SkillInvocation;
  allowedTools?: string[];
  body: string;
  projectRoot?: string;
}

/**
 * Refuse un nom de dossier qui pourrait désigner autre chose que lui-même.
 *
 * Ces noms arrivent d'une requête HTTP et servent à composer un chemin qu'on
 * supprime récursivement : `..` ou un séparateur suffirait à sortir du dossier
 * des skills.
 */
export function safeDirectoryName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new Error("nom de skill vide");
  if (trimmed === "." || trimmed === "..") throw new Error(`nom de skill invalide : ${trimmed}`);
  if (/[\\/:*?"<>|]/.test(trimmed)) throw new Error(`nom de skill invalide : ${trimmed}`);
  return trimmed;
}

function samePathLoose(a: string, b: string): boolean {
  const clean = (path: string) => path.replace(/[\\/]+$/, "").split(/[\\/]/).join("/").toLowerCase();
  return clean(a) === clean(b);
}

/** Sérialise un skill : en-tête régénéré, corps intouché. */
export function renderSkill(draft: SkillDraft): string {
  const fields: [string, string][] = [["name", draft.name?.trim() || draft.directory.trim()]];
  if (draft.description) fields.push(["description", draft.description.replace(/\r?\n/g, " ").trim()]);
  if (draft.allowedTools?.length) fields.push(["allowed-tools", draft.allowedTools.join(", ")]);
  if (draft.invocation === "manual-only") fields.push(["disable-model-invocation", "true"]);
  if (draft.invocation === "auto-only") fields.push(["user-invocable", "false"]);

  const header = fields.map(([key, value]) => `${key}: ${value}`).join("\n");
  const body = draft.body.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  return `---\n${header}\n---\n\n${body.trimStart()}`;
}
