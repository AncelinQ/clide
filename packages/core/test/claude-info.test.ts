import { describe, expect, it } from "vitest";

import { parseStatusPage } from "../src/claude-info/status.js";
import { compareVersions, newerVersion, parseClaudeVersion } from "../src/claude-info/version.js";

/** Un `summary.json` de Statuspage, réduit à ce que la lecture regarde. */
function summary(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    page: { id: "x", name: "Claude", url: "https://status.claude.com" },
    status: { indicator: "none", description: "All Systems Operational" },
    components: [
      { id: "a", name: "claude.ai", status: "operational", group: false },
      { id: "b", name: "Claude API", status: "operational", group: false },
    ],
    incidents: [],
    ...overrides,
  };
}

describe("parseStatusPage", () => {
  it("rend l'état d'ensemble d'une page où tout fonctionne", () => {
    expect(parseStatusPage(summary())).toEqual({
      indicator: "none",
      description: "All Systems Operational",
      degraded: [],
      incidents: [],
    });
  });

  it("garde les composants dégradés, sans les groupes qui ne font que les titrer", () => {
    const status = parseStatusPage(
      summary({
        status: { indicator: "minor", description: "Minor Service Outage" },
        components: [
          { name: "Claude Code", status: "degraded_performance", group: false, group_id: "g" },
          { name: "Plateforme", status: "partial_outage", group: true },
          { name: "claude.ai", status: "operational", group: false },
          { name: "Sans état", group: false },
        ],
      }),
    );
    expect(status.indicator).toBe("minor");
    expect(status.degraded).toEqual([{ name: "Claude Code", status: "degraded_performance" }]);
  });

  it("garde les incidents en cours, avec leur lien quand il est en https", () => {
    const status = parseStatusPage(
      summary({
        incidents: [
          {
            name: "Erreurs sur Opus",
            status: "identified",
            impact: "major",
            shortlink: "https://stspg.io/abc",
            updated_at: "2026-10-26T09:00:00Z",
          },
          { name: "Lenteurs", status: "monitoring", impact: "minor", shortlink: "javascript:alert(1)" },
          { name: "Ancien", status: "resolved", impact: "minor" },
          { name: "Analysé", status: "postmortem", impact: "major" },
        ],
      }),
    );
    expect(status.incidents).toEqual([
      {
        name: "Erreurs sur Opus",
        status: "identified",
        impact: "major",
        url: "https://stspg.io/abc",
        updatedAt: "2026-10-26T09:00:00Z",
      },
      { name: "Lenteurs", status: "monitoring", impact: "minor" },
    ]);
  });

  it("refuse une réponse qui n'est pas une page de statut", () => {
    expect(() => parseStatusPage("<html>")).toThrow("page de statut illisible");
    expect(() => parseStatusPage({ status: {} })).toThrow("page de statut illisible");
    expect(() => parseStatusPage(null)).toThrow("page de statut illisible");
  });

  it("lit une page sans composants ni incidents", () => {
    expect(parseStatusPage({ status: { indicator: "major" } })).toEqual({
      indicator: "major",
      description: "",
      degraded: [],
      incidents: [],
    });
  });
});

describe("versions", () => {
  it("lit la version dans la sortie de claude --version", () => {
    expect(parseClaudeVersion("2.1.283 (Claude Code)\n")).toBe("2.1.283");
    expect(parseClaudeVersion("2.2.0-beta.1 (Claude Code)")).toBe("2.2.0-beta.1");
  });

  it("ne devine rien d'une sortie inattendue", () => {
    expect(parseClaudeVersion("")).toBeUndefined();
    expect(parseClaudeVersion("'claude' n'est pas reconnu en tant que commande interne")).toBeUndefined();
    expect(parseClaudeVersion("v2 (Claude Code)")).toBeUndefined();
  });

  it("compare nombre par nombre, pas comme du texte", () => {
    expect(compareVersions("2.1.10", "2.1.9")).toBe(1);
    expect(compareVersions("2.1.9", "2.1.10")).toBe(-1);
    expect(compareVersions("2.1.0", "2.1.0")).toBe(0);
    expect(compareVersions("3.0.0", "2.99.99")).toBe(1);
  });

  it("place une pré-version avant sa version, et une version illisible avant tout", () => {
    expect(compareVersions("2.2.0-beta.1", "2.2.0")).toBe(-1);
    expect(compareVersions("2.2.0-beta.2", "2.2.0-beta.1")).toBe(1);
    expect(compareVersions("inconnue", "0.0.1")).toBe(-1);
    expect(compareVersions("inconnue", "autre")).toBe(0);
  });

  it("propose la dernière version seulement quand elle est plus récente", () => {
    expect(newerVersion("2.1.283", "2.1.290")).toBe("2.1.290");
    expect(newerVersion("2.1.290", "2.1.290")).toBeUndefined();
    expect(newerVersion("2.1.300", "2.1.290")).toBeUndefined();
    expect(newerVersion(undefined, "2.1.290")).toBeUndefined();
    expect(newerVersion("2.1.283", undefined)).toBeUndefined();
  });
});
