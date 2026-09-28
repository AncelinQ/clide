import { requireParam } from "../api/routes.js";
import { BROWSER_MCP_NAME, BROWSER_PORT, browserMcpConfig, type BrowserMcp } from "../browser/launch.js";
import { ClaudeBrowser, isRelayedKey, type BrowserInput } from "../browser/session.js";
import { addJsonArgs, runClaudeMcp } from "../platform/claude-cli.js";
import type { ServerModule } from "./module.js";

let browser: ClaudeBrowser | undefined;

function current(): ClaudeBrowser {
  if (!browser) throw new Error("module navigateur non démarré");
  return browser;
}

const text = (body: Record<string, unknown>, key: string): string => {
  const value = body[key];
  if (typeof value !== "string" || !value) throw new Error(`champ ${key} manquant`);
  return value;
};

const coordinate = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("coordonnée invalide");
  return value;
};

/** Valide une entrée reçue de la page : elle part telle quelle vers le navigateur. */
function parseInput(value: unknown): BrowserInput {
  if (typeof value !== "object" || value === null) throw new Error("entrée invalide");
  const event = value as Record<string, unknown>;
  switch (event["kind"]) {
    case "click": {
      const button = event["button"];
      return {
        kind: "click",
        x: coordinate(event["x"]),
        y: coordinate(event["y"]),
        ...(button === "middle" || button === "right" ? { button } : {}),
      };
    }
    case "move":
      return { kind: "move", x: coordinate(event["x"]), y: coordinate(event["y"]) };
    case "wheel":
      return {
        kind: "wheel",
        x: coordinate(event["x"]),
        y: coordinate(event["y"]),
        deltaX: coordinate(event["deltaX"]),
        deltaY: coordinate(event["deltaY"]),
      };
    case "text": {
      const typed = event["text"];
      if (typeof typed !== "string" || typed.length > 10_000) throw new Error("texte invalide");
      return { kind: "text", text: typed };
    }
    case "key": {
      const key = event["key"];
      if (typeof key !== "string" || !isRelayedKey(key)) throw new Error("touche non relayée");
      return { kind: "key", key };
    }
    default:
      throw new Error("entrée inconnue");
  }
}

/**
 * Le navigateur que Claude pilote, dans l'aperçu : Clide lance un Chrome (ou un
 * Edge) sans fenêtre avec un port de débogage local, le MCP navigateur de Claude
 * s'y branche, et l'aperçu en montre la page — clics et frappes relayés pour
 * reprendre la main.
 *
 * Jamais le port de débogage d'Electron : il donnerait la main sur toute
 * l'application, jeton compris.
 */
export const browserModule: ServerModule = {
  id: "browser",
  start(context) {
    browser = new ClaudeBrowser(context.dataDir);
    browser.onState((state) => context.bus.emit("broadcast", { t: "browser", state }));
    browser.onFrame((frame) => context.bus.emit("broadcast", { t: "browser.frame", frame }));
    context.bus.on("watch", (topic, on) => {
      if (topic === "browser") current().watch(on);
    });
  },
  async stop() {
    await browser?.stop();
  },
  routes: {
    "/api/browser": async () => ({
      state: current().state,
      mcp: {
        name: BROWSER_MCP_NAME,
        port: BROWSER_PORT,
        configs: { "chrome-devtools": browserMcpConfig("chrome-devtools"), playwright: browserMcpConfig("playwright") },
      },
    }),
  },
  mutations: {
    "/api/browser/start": async () => {
      await current().start();
      return { state: current().state };
    },
    "/api/browser/stop": async () => {
      await current().stop();
      return { state: current().state };
    },
    "/api/browser/select": async (_params, _context, body) => {
      current().select(text(body, "id"));
      return { state: current().state };
    },
    "/api/browser/navigate": async (_params, _context, body) => {
      await current().navigate(text(body, "url"));
      return { ok: true };
    },
    "/api/browser/input": async (_params, _context, body) => {
      await current().input(parseInput(body["event"]));
      return { ok: true };
    },
    /**
     * Déclare le MCP du navigateur pour le projet, en portée `local` : il est à
     * l'utilisateur, dans ce dossier, sans rien écrire dans le dépôt. Passe par
     * `claude mcp add-json`, jamais en écrivant la configuration de Claude Code.
     */
    "/api/browser/mcp": async (params, _context, body) => {
      const root = typeof body["root"] === "string" ? body["root"] : requireParam(params, "root");
      const kind = body["kind"];
      if (kind !== "chrome-devtools" && kind !== "playwright") throw new Error("MCP inconnu");
      return { output: await runClaudeMcp(addJsonArgs("local", BROWSER_MCP_NAME, browserMcpConfig(kind as BrowserMcp)), root) };
    },
  },
};
