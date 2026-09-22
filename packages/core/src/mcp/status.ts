export type McpHealth = "connected" | "needs-auth" | "failed";

export interface McpStatus {
  name: string;
  health: McpHealth;
  /** Cause d'un échec, telle que la CLI la rapporte. */
  detail?: string;
  /**
   * Connecteur claude.ai. Il est rattaché au compte et n'apparaît dans aucun
   * fichier de configuration : cette liste est le seul endroit où il se voit.
   */
  connector: boolean;
}

/** Préfixe dont la CLI marque les connecteurs du compte. */
const CONNECTOR_PREFIX = "claude.ai ";

const HEALTH: Readonly<Record<string, McpHealth>> = {
  "✔": "connected",
  "✘": "failed",
  "!": "needs-auth",
};

/**
 * `<nom>: <cible> - <glyphe> <libellé>`.
 *
 * La cible est gourmande pour que le découpage tombe sur le **dernier** ` - `
 * suivi d'un glyphe : une commande de serveur en contient volontiers d'autres.
 * Le nom, lui, s'arrête au premier `: ` — un deux-points collé, comme dans une
 * URL ou une lettre de lecteur, ne le termine pas.
 */
const ENTRY = /^(.+?): (.*) - ([✔✘!])\s*(.*)$/u;

/** Séquences de couleur, que la CLI ajoute dès qu'elle se croit sur un terminal. */
const ANSI = /\u001B\[[0-9;]*m/g;

/**
 * Lit la sortie de `claude mcp list`.
 *
 * Seuls le nom et l'état sont retenus : la cible est déjà connue des panneaux,
 * qui la tiennent de la configuration.
 *
 * Les lignes qui ne portent pas d'état sont ignorées plutôt que devinées — la
 * commande annonce d'abord sa progression, et rien ne garantit qu'elle s'en
 * tienne à cela.
 */
export function parseMcpStatus(output: string): McpStatus[] {
  const statuses: McpStatus[] = [];

  for (const raw of output.replace(ANSI, "").split("\n")) {
    const match = ENTRY.exec(raw.trim());
    if (!match) continue;

    const [, rawName, , glyph, label] = match;
    const health = HEALTH[glyph as string];
    if (!health || !rawName) continue;

    const connector = rawName.startsWith(CONNECTOR_PREFIX);
    const detail = health === "failed" ? cause(label ?? "") : undefined;

    statuses.push({
      name: connector ? rawName.slice(CONNECTOR_PREFIX.length) : rawName,
      health,
      ...(detail ? { detail } : {}),
      connector,
    });
  }

  return statuses;
}

/**
 * Ce qui suit le tiret cadratin d'un libellé d'échec : la cause, sans la
 * redite de l'état qui la précède.
 */
function cause(label: string): string {
  const dash = label.indexOf("—");
  return (dash === -1 ? label : label.slice(dash + 1)).trim();
}
