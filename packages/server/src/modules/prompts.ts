import { join } from "node:path";

import { PromptStore, topCommands, type SavedPrompt } from "@clide/core";

import { refreshSearch } from "../api/routes.js";
import type { ServerModule } from "./module.js";

const storeOf = (dataDir: string) => new PromptStore(join(dataDir, "prompts.json"));
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const scopeOf = (value: unknown): SavedPrompt["scope"] => (value === "project" ? "project" : "user");

/**
 * Commandes de Claude Code lui-même : on les tape souvent, mais un prompt
 * enregistré n'apporterait rien à `/clear` ou `/model`.
 */
const BUILT_IN = [
  "/add-dir", "/agents", "/bug", "/clear", "/compact", "/config", "/context", "/cost", "/doctor", "/exit", "/export",
  "/help", "/hooks", "/ide", "/init", "/login", "/logout", "/mcp", "/memory", "/model", "/output-style", "/permissions",
  "/plugin", "/pr-comments", "/release-notes", "/resume", "/review", "/rewind", "/status", "/statusline", "/terminal-setup",
  "/todos", "/upgrade", "/usage", "/vim",
];

/** Au-delà de trente jours, une habitude n'en est plus une. */
const SUGGESTION_WINDOW_MS = 30 * 24 * 3600 * 1000;

/**
 * Prompts enregistrés : ceux de l'utilisateur dans le dossier de données de
 * Clide, ceux du projet dans `.claude/clide-prompts.json`, qu'on peut versionner.
 */
export const prompts: ServerModule = {
  id: "prompts",
  routes: {
    "/api/prompts": async (params, { dataDir }) => ({ prompts: await storeOf(dataDir).list(params.get("root") || undefined) }),

    /** Commandes `/…` tapées souvent ces trente derniers jours, et pas encore enregistrées. */
    "/api/prompts/suggestions": async (params, { dataDir, search }) => {
      await refreshSearch(search);
      const saved = await storeOf(dataDir).list(params.get("root") || undefined);
      const exclude = new Set([...BUILT_IN, ...saved.map((prompt) => prompt.text.trim().split(/\s+/)[0] ?? "")]);
      return { suggestions: topCommands(search.commands(), { since: Date.now() - SUGGESTION_WINDOW_MS, exclude }) };
    },
  },
  mutations: {
    "/api/prompts/save": async (_params, { dataDir }, body) => {
      const prompt = (typeof body["prompt"] === "object" && body["prompt"] !== null ? body["prompt"] : {}) as Record<string, unknown>;
      const root = text(body["root"]) || undefined;
      return {
        prompt: await storeOf(dataDir).save(
          {
            ...(text(prompt["id"]) ? { id: text(prompt["id"]) } : {}),
            label: text(prompt["label"]),
            text: text(prompt["text"]),
            mode: prompt["mode"] === "insert" ? "insert" : "send",
            scope: scopeOf(prompt["scope"]),
          },
          root,
        ),
      };
    },

    "/api/prompts/remove": async (_params, { dataDir }, body) => {
      await storeOf(dataDir).remove(text(body["id"]), scopeOf(body["scope"]), text(body["root"]) || undefined);
      return { ok: true };
    },
  },
};
