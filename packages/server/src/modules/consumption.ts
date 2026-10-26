import { claudeInfoReader } from "../platform/claude-info.js";
import { installStatusline, readUsage, refreshApiUsage, uninstallStatusline } from "../platform/usage.js";
import { costReport } from "../sessions/costs.js";
import type { ServerModule } from "./module.js";

const readClaudeInfo = claudeInfoReader();

/** Consommation : limites de l'abonnement, coût des sessions, version de Claude Code et état des services. */
export const consumption: ServerModule = {
  id: "consumption",
  routes: {
    /** Limites de l'abonnement et usage des sessions, tels que les deux sources les ont relevés. */
    "/api/usage": async (_params, { dataDir, settingsPath }) => readUsage(dataDir, settingsPath),

    /** Consommation de toutes les sessions : totaux, jours, projets, modèles, tarifs déduits. */
    "/api/costs": async (_params, { index }) => {
      await index.refresh();
      await index.save();
      return costReport(index);
    },

    /**
     * Version installée de Claude Code, dernière version publiée et état des
     * services. Sources publiques, sans identifiant : lues à l'ouverture de
     * l'onglet, et gardées un moment. `refresh=1` les relit.
     */
    "/api/claude-info": async (params) => readClaudeInfo(params.get("refresh") === "1"),
  },
  mutations: {
    /** Déclare la ligne de statut qui relève l'usage. Action explicite, comme les hooks. */
    "/api/usage/statusline/install": async (_params, { dataDir, settingsPath }) => ({
      statusline: await installStatusline(dataDir, settingsPath),
    }),

    "/api/usage/statusline/uninstall": async (_params, { dataDir, settingsPath }) => ({
      statusline: await uninstallStatusline(dataDir, settingsPath),
    }),

    /**
     * Demande les limites à l'API d'usage de Claude Code. Jamais automatique :
     * l'API n'est pas documentée et limite les appels.
     */
    "/api/usage/refresh": async (_params, { dataDir }) => ({ api: await refreshApiUsage(dataDir) }),
  },
};
