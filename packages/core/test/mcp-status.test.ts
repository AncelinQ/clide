import { describe, expect, it } from "vitest";

import { parseMcpStatus } from "../src/mcp/status.js";

/** Sortie de `claude mcp list`, reprise telle quelle. */
const OUTPUT = [
  "Checking MCP server health…",
  "",
  "claude.ai Granola: https://mcp.granola.ai/mcp - ! Needs authentication",
  "claude.ai Google Calendar: https://calendarmcp.googleapis.com/mcp/v1 - ✔ Connected",
  "linear: https://mcp.linear.app/mcp (HTTP) - ✔ Connected",
  "context7: cmd /c npx -y @upstash/context7-mcp - ✔ Connected",
  "serena: C:/Users/moi/.local/bin/serena.exe start-mcp-server --context claude-code - ✔ Connected",
  "webstorm: http://127.0.0.1:64542/stream (HTTP) - ✘ Failed to connect — ECONNREFUSED: Unable to connect.",
].join("\n");

describe("parseMcpStatus", () => {
  it("lit les trois états", () => {
    const byName = new Map(parseMcpStatus(OUTPUT).map((s) => [s.name, s]));
    expect(byName.get("linear")?.health).toBe("connected");
    expect(byName.get("Granola")?.health).toBe("needs-auth");
    expect(byName.get("webstorm")?.health).toBe("failed");
  });

  it("distingue les connecteurs du compte et leur retire leur préfixe", () => {
    const statuses = parseMcpStatus(OUTPUT);
    expect(statuses.filter((s) => s.connector).map((s) => s.name)).toEqual([
      "Granola",
      "Google Calendar",
    ]);
    expect(statuses.find((s) => s.name === "linear")?.connector).toBe(false);
  });

  it("ne coupe pas une cible qui contient elle-même un tiret entouré d'espaces", () => {
    // La commande d'un serveur en porte volontiers : le découpage doit tomber
    // sur le dernier, celui que suit le glyphe d'état.
    const [status] = parseMcpStatus("local: node serveur.js --flag - valeur - ✔ Connected");
    expect(status?.name).toBe("local");
    expect(status?.health).toBe("connected");
  });

  it("garde la cause d'un échec, sans la redite de l'état", () => {
    const failed = parseMcpStatus(OUTPUT).find((s) => s.name === "webstorm");
    expect(failed?.detail).toBe("ECONNREFUSED: Unable to connect.");
  });

  it("ne rapporte de cause que pour un échec", () => {
    expect(parseMcpStatus(OUTPUT).find((s) => s.name === "linear")?.detail).toBeUndefined();
  });

  it("ignore l'annonce de progression et les lignes vides", () => {
    expect(parseMcpStatus(OUTPUT)).toHaveLength(6);
    expect(parseMcpStatus("Checking MCP server health…\n\n")).toEqual([]);
  });

  it("survit à une sortie colorée", () => {
    const [status] = parseMcpStatus("\u001B[1mlinear\u001B[0m: https://x - \u001B[32m✔\u001B[0m Connected");
    expect(status?.name).toBe("linear");
    expect(status?.health).toBe("connected");
  });
});
