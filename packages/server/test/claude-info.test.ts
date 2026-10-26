import { describe, expect, it } from "vitest";

import { NPM_LATEST, STATUS_URL, claudeInfoReader, type ClaudeInfoSources } from "../src/platform/claude-info.js";

const PAGE = {
  status: { indicator: "minor", description: "Minor Service Outage" },
  components: [{ name: "Claude Code", status: "degraded_performance", group: false }],
  incidents: [{ name: "Lenteurs", status: "monitoring", impact: "minor", shortlink: "https://stspg.io/x" }],
};

/** Fausses sources, qui comptent leurs appels ; chaque réponse peut être remplacée. */
function sources(overrides: Partial<ClaudeInfoSources> = {}) {
  const calls = { version: 0, npm: 0, status: 0 };
  let clock = 0;
  const fake: ClaudeInfoSources = {
    runVersion: async () => {
      calls.version += 1;
      return "2.1.283 (Claude Code)\n";
    },
    fetchJson: async (url) => {
      if (url === NPM_LATEST) {
        calls.npm += 1;
        return { name: "@anthropic-ai/claude-code", version: "2.1.290" };
      }
      if (url === STATUS_URL) {
        calls.status += 1;
        return PAGE;
      }
      throw new Error(`adresse inattendue : ${url}`);
    },
    now: () => clock,
    ...overrides,
  };
  return { fake, calls, advance: (ms: number) => (clock += ms) };
}

describe("claudeInfoReader", () => {
  it("assemble la version installée, la dernière publiée et l'état des services", async () => {
    const read = claudeInfoReader(sources().fake);
    expect(await read()).toEqual({
      version: "2.1.283",
      latest: "2.1.290",
      update: "2.1.290",
      status: {
        indicator: "minor",
        description: "Minor Service Outage",
        degraded: [{ name: "Claude Code", status: "degraded_performance" }],
        incidents: [{ name: "Lenteurs", status: "monitoring", impact: "minor", url: "https://stspg.io/x" }],
      },
    });
  });

  it("ne propose pas de mise à jour à une version à jour", async () => {
    const { fake } = sources({ runVersion: async () => "2.1.290 (Claude Code)" });
    expect(await claudeInfoReader(fake)()).toMatchObject({ version: "2.1.290", latest: "2.1.290", update: null });
  });

  it("garde chaque source le temps qui lui est propre, et relit tout sur demande", async () => {
    const { fake, calls, advance } = sources();
    const read = claudeInfoReader(fake);
    await Promise.all([read(), read()]);
    await read();
    expect(calls).toEqual({ version: 1, npm: 1, status: 1 });

    advance(5 * 60_000 + 1);
    await read();
    expect(calls).toEqual({ version: 1, npm: 1, status: 2 });

    advance(5 * 60_000);
    await read();
    expect(calls).toEqual({ version: 2, npm: 1, status: 2 });

    await read(true);
    expect(calls).toEqual({ version: 3, npm: 2, status: 3 });
  });

  it("dit la version introuvable quand la CLI manque, sans toucher au reste", async () => {
    const { fake } = sources({
      runVersion: async () => {
        throw new Error("'claude' n'est pas reconnu en tant que commande interne");
      },
    });
    expect(await claudeInfoReader(fake)()).toMatchObject({ version: null, latest: "2.1.290", update: null });
  });

  it("se passe de la dernière version quand npm ne répond pas", async () => {
    const { fake } = sources();
    const fetchJson = fake.fetchJson;
    const read = claudeInfoReader({
      ...fake,
      fetchJson: async (url) => {
        if (url === NPM_LATEST) throw new Error("HTTP 503");
        return fetchJson(url);
      },
    });
    const info = await read();
    expect(info).toMatchObject({ version: "2.1.283", latest: null, update: null });
    expect(info.status?.indicator).toBe("minor");
  });

  it("dit pourquoi la page de statut manque", async () => {
    const failing = (error: unknown) =>
      claudeInfoReader({
        ...sources().fake,
        fetchJson: async (url) => {
          if (url === STATUS_URL) throw error;
          return { version: "2.1.290" };
        },
      })();

    expect(await failing(new Error("HTTP 503"))).toMatchObject({ status: null, statusError: "HTTP 503" });
    expect(await failing(Object.assign(new Error("aborted"), { name: "TimeoutError" }))).toMatchObject({
      statusError: "délai dépassé",
    });
    expect(await failing(new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } }))).toMatchObject({
      statusError: "réseau injoignable (ENOTFOUND)",
    });
  });

  it("refuse une réponse qui n'est pas une page de statut", async () => {
    const { fake } = sources();
    const read = claudeInfoReader({
      ...fake,
      fetchJson: async (url) => (url === STATUS_URL ? "<html>maintenance</html>" : { version: "2.1.290" }),
    });
    expect(await read()).toMatchObject({ status: null, statusError: "page de statut illisible" });
  });
});
