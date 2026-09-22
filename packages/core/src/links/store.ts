import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { SettingsEditor, type SettingsEdit } from "../settings/editor.js";

export interface ProjectLink {
  /** Chemin absolu du dossier lié. */
  path: string;
  /** Rôle libre — « api », « design system » — transmis à Claude au lancement. */
  role?: string;
  /** Claude peut lire le dossier mais pas y écrire. */
  readOnly: boolean;
}

/** Fichiers écrits par le magasin, relatifs à la racine du projet. */
export const LINKS_SETTINGS = join(".claude", "settings.local.json");
export const LINKS_ROLES = join(".claude", "claude-ide.json");
export const LINKS_PROMPT = join(".claude", "claude-ide-prompt.md");

/** Chemin du fichier de prompt d'un projet. */
export function promptPath(projectRoot: string): string {
  return join(projectRoot, LINKS_PROMPT);
}

function absolutePattern(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * Règle de refus d'écriture sur un dossier lié.
 *
 * Le double `/` initial est ce qui rend le chemin absolu aux yeux de Claude
 * Code : un seul `/` le rendrait relatif au projet et la règle ne protégerait rien.
 *
 * Seul `Edit` est posé. C'est la seule forme que Claude Code confronte aux
 * écritures de fichiers, et elle couvre tous les outils qui en font ; un `Write`
 * visant un chemin reste sans effet et se fait signaler à chaque démarrage de
 * session.
 */
export function denyRules(path: string): string[] {
  return [`Edit(//${absolutePattern(path)}/**)`];
}

/**
 * Règles dont le magasin se considère l'auteur pour un dossier.
 *
 * Plus large que ce qu'il pose : il ne retire que ce qu'il reconnaît, donc une
 * forme qu'il n'écrit pas resterait en place indéfiniment.
 */
function managedRules(path: string): string[] {
  const target = absolutePattern(path);
  return [`Edit(//${target}/**)`, `Write(//${target}/**)`];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * Dossiers dont un projet dépend — l'API, le design system — déclarés de façon
 * que Claude y accède sans qu'on ait à le lui redire à chaque session.
 *
 * Les chemins vont dans `permissions.additionalDirectories` de
 * `.claude/settings.local.json`, mécanisme natif de Claude Code ; les rôles, qui
 * n'ont pas d'équivalent natif, vivent à part dans `.claude/claude-ide.json`.
 * Les deux fichiers sont édités chirurgicalement : `settings.local.json` porte
 * aussi la liste des permissions accordées au fil des sessions, qu'une
 * réécriture complète perdrait.
 */
export class LinkStore {
  readonly #editor = new SettingsEditor();

  async read(projectRoot: string): Promise<ProjectLink[]> {
    const settings = await this.#editor.read(join(projectRoot, LINKS_SETTINGS));
    const permissions = asRecord(settings.value["permissions"]) ?? {};
    const directories = stringList(permissions["additionalDirectories"]);
    const deny = new Set(stringList(permissions["deny"]));
    const roles = await this.#readRoles(projectRoot);

    return directories.map((path) => {
      const role = roles[path];
      return {
        path,
        ...(role ? { role } : {}),
        readOnly: denyRules(path).every((rule) => deny.has(rule)),
      };
    });
  }

  async #readRoles(projectRoot: string): Promise<Record<string, string>> {
    try {
      const parsed: unknown = JSON.parse(await readFile(join(projectRoot, LINKS_ROLES), "utf8"));
      const roles = asRecord(asRecord(parsed)?.["roles"]);
      if (!roles) return {};
      return Object.fromEntries(
        Object.entries(roles).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      );
    } catch {
      return {};
    }
  }

  /**
   * Remplace l'ensemble des liens.
   *
   * Les règles de refus des liens retirés sont enlevées une à une : les autres
   * entrées de `deny`, posées à la main ou par Claude Code, ne sont pas touchées.
   */
  async write(projectRoot: string, links: readonly ProjectLink[]): Promise<void> {
    const settingsFile = join(projectRoot, LINKS_SETTINGS);
    await mkdir(join(projectRoot, ".claude"), { recursive: true });

    const current = await this.#editor.read(settingsFile);
    const permissions = asRecord(current.value["permissions"]) ?? {};
    const previousDirectories = stringList(permissions["additionalDirectories"]);
    const previousDeny = stringList(permissions["deny"]);

    const managed = new Set(previousDirectories.flatMap(managedRules));
    const wanted = new Set(links.filter((link) => link.readOnly).flatMap((link) => denyRules(link.path)));

    const deny = [
      ...previousDeny.filter((rule) => !managed.has(rule) || wanted.has(rule)),
      ...[...wanted].filter((rule) => !previousDeny.includes(rule)),
    ];

    const edits: SettingsEdit[] = [
      { path: ["permissions", "additionalDirectories"], value: links.map((link) => link.path) },
      { path: ["permissions", "deny"], value: deny.length > 0 ? deny : undefined },
    ];
    await this.#editor.update(settingsFile, edits);

    const roles = Object.fromEntries(
      links.filter((link) => link.role).map((link) => [link.path, link.role as string]),
    );
    await this.#editor.update(join(projectRoot, LINKS_ROLES), [{ path: ["roles"], value: roles }]);

    await this.writePrompt(projectRoot);
  }

  /**
   * Texte décrivant les liens, à passer à Claude au lancement de la session.
   *
   * Vide quand il n'y a rien à dire, pour ne pas ajouter du bruit au prompt.
   * Il reste court : ce texte est préfixé à chaque requête de la session, et le
   * rôle d'un dossier tient en quelques mots.
   */
  static describe(links: readonly ProjectLink[]): string {
    if (links.length === 0) return "";
    const lines = links.map((link) => {
      const role = link.role ? ` — ${link.role}` : "";
      const mode = link.readOnly ? " · lecture seule, ne rien y écrire" : "";
      return `- \`${link.path}\`${role}${mode}`;
    });
    return [
      "Ce projet dépend de dossiers situés hors de sa racine. Ils sont déjà",
      "accessibles : les lire ne demande ni chemin ni autorisation.",
      "",
      ...lines,
    ].join("\n");
  }

  /**
   * Écrit le fichier de prompt décrivant les liens, et rend son chemin.
   *
   * C'est ce fichier qui apprend à Claude à quoi servent les dossiers liés :
   * `additionalDirectories` lui en donne l'accès, rien de plus. Il est retiré
   * quand il ne reste aucun lien, car un fichier laissé là décrirait des
   * dossiers dont le projet ne dépend plus. Un projet sans lien n'en reçoit
   * jamais.
   */
  async writePrompt(projectRoot: string): Promise<string | undefined> {
    const path = promptPath(projectRoot);
    const text = LinkStore.describe(await this.read(projectRoot));
    if (text.length === 0) {
      await rm(path, { force: true });
      return undefined;
    }
    await mkdir(join(projectRoot, ".claude"), { recursive: true });
    await writeFile(path, `${PROMPT_HEADER}\n\n${text}\n`, "utf8");
    return path;
  }
}

const PROMPT_HEADER =
  "<!-- Généré par claude-ide depuis .claude/claude-ide.json. Toute modification sera écrasée. -->";
