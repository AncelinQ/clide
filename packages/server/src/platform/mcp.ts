import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { parseMcpStatus, type McpStatus } from "@claude-ide/core";

const run = promisify(execFile);

/**
 * La commande interroge chaque serveur l'un après l'autre : une poignée de
 * secondes en temps normal, indéfiniment si l'un d'eux ne répond ni n'échoue.
 */
const TIMEOUT_MS = 90_000;

/**
 * État des serveurs MCP, tel que `claude mcp list` le rapporte.
 *
 * L'appel se fait par le shell : la CLI s'installe aussi bien en exécutable
 * qu'en script `.cmd`, que Node refuse de lancer directement. Les arguments
 * sont figés, rien de l'extérieur n'entre dans la ligne de commande.
 *
 * Le dossier compte : les portées projet et locale ne se lisent que depuis la
 * racine concernée.
 */
export async function readMcpStatus(projectRoot?: string): Promise<McpStatus[]> {
  try {
    const { stdout } = await run("claude", ["mcp", "list"], {
      ...(projectRoot ? { cwd: projectRoot } : {}),
      shell: true,
      windowsHide: true,
      timeout: TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    });
    return parseMcpStatus(stdout);
  } catch (error) {
    // Un serveur injoignable peut faire sortir la commande en échec ; ce
    // qu'elle a écrit avant reste l'état des autres.
    const partial = (error as { stdout?: unknown }).stdout;
    if (typeof partial === "string" && partial.length > 0) return parseMcpStatus(partial);
    throw error;
  }
}
