import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { claudeHome } from "../paths.js";

export type McpScope = "project" | "local" | "user";
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
 * Lecture seule. Écrire dans `~/.claude.json` revient à réécrire un fichier qui
 * porte aussi l'historique et l'état de chaque projet : cela passe par la CLI
 * `claude mcp`, hors de ce module qui ne touche pas au système.
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

  async listProject(projectRoot: string): Promise<McpServer[]> {
    const config = await this.#readJson(join(projectRoot, ".mcp.json"));
    const servers = asRecord(config?.["mcpServers"]) ?? {};
    return Object.entries(servers)
      .map(([name, value]) => toServer(name, "project", asRecord(value) ?? {}))
      .sort((a, b) => a.name.localeCompare(b.name));
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

function normalizeRoot(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).join("/").toLowerCase();
}
