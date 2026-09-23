import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { claudeHome } from "../paths.js";
import { SettingsEditor } from "../settings/editor.js";

/**
 * Portée d'un serveur. `linked` désigne le `.mcp.json` d'un dossier lié : il ne
 * s'applique pas au projet, mais on le montre pour pouvoir le reprendre.
 */
export type McpScope = "project" | "local" | "user" | "linked";

/** Portées dont un serveur se relit en entier, pour être copié ou édité. */
export type McpSourceScope = "project" | "local" | "user";
export type McpTransport = "stdio" | "http" | "sse";

export interface McpServer {
  name: string;
  scope: McpScope;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  /** Vrai quand `env` ou `headers` ont été masqués. */
  redacted: boolean;
  /** Dossier dont vient le serveur, pour un dossier lié ou un autre projet. */
  source?: string;
}

/** Ce qui remplace une valeur masquée. */
export const MASK = "***";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringMap(value: unknown): Record<string, string> | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === "string") out[key] = item;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function transportOf(config: Record<string, unknown>): McpTransport {
  const declared = config["type"];
  if (declared === "http" || declared === "sse" || declared === "stdio") return declared;
  return typeof config["url"] === "string" ? "http" : "stdio";
}

function toServer(name: string, scope: McpScope, config: Record<string, unknown>): McpServer {
  const args = Array.isArray(config["args"])
    ? config["args"].filter((item): item is string => typeof item === "string")
    : undefined;
  const command = typeof config["command"] === "string" ? config["command"] : undefined;
  const url = typeof config["url"] === "string" ? config["url"] : undefined;
  const env = stringMap(config["env"]);
  const headers = stringMap(config["headers"]);

  return {
    name,
    scope,
    transport: transportOf(config),
    ...(command ? { command } : {}),
    ...(args ? { args } : {}),
    ...(url ? { url } : {}),
    ...(env ? { env } : {}),
    ...(headers ? { headers } : {}),
    redacted: false,
  };
}

/**
 * Masque les valeurs de `env` et `headers`, en gardant les clés.
 *
 * Ces champs portent des jetons d'accès. Les clés suffisent à l'affichage et au
 * diagnostic — savoir qu'un serveur attend `Authorization` est utile, sa valeur
 * n'a rien à faire dans un rendu, un journal ou un rapport.
 */
export function redactServer(server: McpServer): McpServer {
  const mask = (record: Record<string, string> | undefined): Record<string, string> | undefined =>
    record ? Object.fromEntries(Object.keys(record).map((key) => [key, MASK])) : undefined;

  const env = mask(server.env);
  const headers = mask(server.headers);
  return {
    ...server,
    ...(env ? { env } : {}),
    ...(headers ? { headers } : {}),
    redacted: Boolean(server.env ?? server.headers),
  };
}

/**
 * Serveurs MCP visibles depuis un projet, sur les trois portées de Claude Code.
 *
 * - `project` : `.mcp.json` à la racine du dépôt, partagé par l'équipe.
 * - `local`   : `~/.claude.json`, sous `projects[<chemin>].mcpServers`, privé au projet.
 * - `user`    : `~/.claude.json`, sous `mcpServers`, valable partout.
 *
 * Les trois portées se lisent ; seule la portée projet s'écrit. Écrire dans
 * `~/.claude.json` reviendrait à réécrire un fichier qui porte aussi l'historique
 * et l'état de chaque projet : les portées `local` et `user` passent par la CLI
 * `claude mcp`, hors de ce module.
 */
export class McpStore {
  readonly #userConfigFile: string;

  /**
   * `~/.claude.json` est le voisin de `~/.claude`, pas son contenu. Le chemin
   * reste surchargeable pour les tests et pour un `CLAUDE_CONFIG_DIR` déplacé.
   */
  constructor(home: string = claudeHome(), userConfigFile?: string) {
    this.#userConfigFile = userConfigFile ?? join(home, "..", ".claude.json");
  }

  get userConfigFile(): string {
    return this.#userConfigFile;
  }

  async #readJson(file: string): Promise<Record<string, unknown> | undefined> {
    try {
      const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
      return asRecord(parsed);
    } catch {
      return undefined;
    }
  }

  async listUser(): Promise<McpServer[]> {
    const config = await this.#readJson(this.userConfigFile);
    const servers = asRecord(config?.["mcpServers"]) ?? {};
    return Object.entries(servers)
      .map(([name, value]) => toServer(name, "user", asRecord(value) ?? {}))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Les clés de `projects` sont des chemins tels que Claude Code les a écrits.
   * La comparaison ignore la casse et le style de séparateur, sinon
   * `C:/Projets/x` et `C:\Projets\x` désigneraient deux projets différents.
   */
  async listLocal(projectRoot: string): Promise<McpServer[]> {
    const config = await this.#readJson(this.userConfigFile);
    const projects = asRecord(config?.["projects"]) ?? {};
    const wanted = normalizeRoot(projectRoot);

    for (const [key, value] of Object.entries(projects)) {
      if (normalizeRoot(key) !== wanted) continue;
      const servers = asRecord(asRecord(value)?.["mcpServers"]) ?? {};
      return Object.entries(servers)
        .map(([name, item]) => toServer(name, "local", asRecord(item) ?? {}))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    return [];
  }

  /**
   * Configuration d'un serveur telle qu'écrite, secrets compris.
   *
   * Elle ne quitte pas le serveur : une copie ou une édition la relit ici plutôt
   * que de la faire transiter par la page, qui ne voit que des valeurs masquées.
   */
  async rawConfig(scope: McpSourceScope, root: string, name: string): Promise<Record<string, unknown> | undefined> {
    if (scope === "project") {
      const config = await this.#readJson(join(root, ".mcp.json"));
      return asRecord(asRecord(config?.["mcpServers"])?.[name]);
    }
    const config = await this.#readJson(this.userConfigFile);
    if (scope === "user") return asRecord(asRecord(config?.["mcpServers"])?.[name]);
    const projects = asRecord(config?.["projects"]) ?? {};
    const wanted = normalizeRoot(root);
    for (const [key, value] of Object.entries(projects)) {
      if (normalizeRoot(key) === wanted) return asRecord(asRecord(asRecord(value)?.["mcpServers"])?.[name]);
    }
    return undefined;
  }

  /** Serveurs du `.mcp.json` de chaque dossier lié, marqués de leur dossier. */
  async listLinked(folders: string[]): Promise<McpServer[]> {
    const lists = await Promise.all(
      folders.map(async (folder) =>
        (await this.listProject(folder)).map((server) => ({ ...server, scope: "linked" as const, source: folder })),
      ),
    );
    return lists.flat();
  }

  /**
   * Serveurs déjà configurés ailleurs, à reprendre sans les retaper.
   *
   * Un nom n'apparaît qu'une fois, pris dans le premier dossier qui le déclare :
   * le même serveur est souvent recopié d'un dépôt à l'autre.
   */
  async library(folders: string[], excluding: string[] = []): Promise<McpServer[]> {
    const skip = new Set(excluding.map(normalizeRoot));
    const seen = new Set<string>();
    const out: McpServer[] = [];
    for (const folder of folders) {
      if (skip.has(normalizeRoot(folder))) continue;
      for (const server of await this.listProject(folder)) {
        if (seen.has(server.name)) continue;
        seen.add(server.name);
        out.push({ ...server, source: folder });
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Recopie un serveur d'une portée ou d'un dossier dans le `.mcp.json` du projet. */
  async copyToProject(
    targetRoot: string,
    from: { scope: McpSourceScope; root: string; name: string },
  ): Promise<McpServer> {
    const config = await this.rawConfig(from.scope, from.root, from.name);
    if (!config) throw new Error(`serveur ${from.name} introuvable`);
    return this.saveProjectServer(targetRoot, from.name, config);
  }

  async listProject(projectRoot: string): Promise<McpServer[]> {
    const config = await this.#readJson(join(projectRoot, ".mcp.json"));
    const servers = asRecord(config?.["mcpServers"]) ?? {};
    return Object.entries(servers)
      .map(([name, value]) => toServer(name, "project", asRecord(value) ?? {}))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Écrit un serveur dans le `.mcp.json` du projet.
   *
   * Édition chirurgicale : ce fichier est versionné et partagé par l'équipe,
   * une réécriture complète produirait un diff illisible sur un ajout d'une ligne.
   *
   * Seule la portée projet s'écrit ici. Les portées `local` et `user` vivent dans
   * `~/.claude.json`, qui porte aussi l'historique et l'état de chaque projet :
   * elles passent par la CLI `claude mcp`, hors de ce module.
   */
  async saveProjectServer(
    projectRoot: string,
    name: string,
    config: Record<string, unknown>,
  ): Promise<McpServer> {
    const file = join(projectRoot, ".mcp.json");
    const editor = new SettingsEditor();
    await editor.update(file, [{ path: ["mcpServers", safeServerName(name)], value: config }]);
    return toServer(name, "project", config);
  }

  async removeProjectServer(projectRoot: string, name: string): Promise<boolean> {
    const file = join(projectRoot, ".mcp.json");
    const editor = new SettingsEditor();
    const current = await editor.read(file);
    const servers = asRecord(current.value["mcpServers"]) ?? {};
    if (!(name in servers)) return false;

    await editor.update(file, [{ path: ["mcpServers", name], value: undefined }]);
    return true;
  }

  /**
   * Les trois portées réunies. Les valeurs sensibles sont masquées sauf demande
   * explicite : c'est le défaut sûr, parce que ce résultat finit affiché.
   */
  async listAll(projectRoot: string, options: { reveal?: boolean } = {}): Promise<McpServer[]> {
    const [project, local, user] = await Promise.all([
      this.listProject(projectRoot),
      this.listLocal(projectRoot),
      this.listUser(),
    ]);
    const all = [...project, ...local, ...user];
    return options.reveal ? all : all.map(redactServer);
  }
}

/**
 * Un nom de serveur devient une clé de chemin dans l'arbre JSON : un nom vide ou
 * porteur d'un point désignerait une clé imbriquée qu'on n'a pas demandée.
 */
export function safeServerName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new Error("nom de serveur vide");
  if (trimmed.includes(".")) throw new Error(`nom de serveur invalide : ${trimmed}`);
  return trimmed;
}

function normalizeRoot(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).join("/").toLowerCase();
}

/**
 * Remet les valeurs d'origine à la place des valeurs masquées.
 *
 * La page ne voit `env` et `headers` que masqués : un serveur qu'on édite revient
 * avec des `***` là où l'on n'a rien touché. Une valeur masquée sans valeur
 * d'origine est refusée plutôt qu'écrite telle quelle : `***` n'est le jeton de
 * personne.
 */
export function restoreMasked(
  config: Record<string, unknown>,
  previous: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const out = { ...config };
  for (const field of ["env", "headers"] as const) {
    const values = asRecord(config[field]);
    if (!values) continue;
    const before = asRecord(previous?.[field]) ?? {};
    const restored: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
      if (value !== MASK) {
        restored[key] = value;
        continue;
      }
      if (typeof before[key] !== "string") throw new Error(`valeur masquée sans valeur d'origine : ${field}.${key}`);
      restored[key] = before[key];
    }
    out[field] = restored;
  }
  return out;
}
