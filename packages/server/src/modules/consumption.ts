import { installStatusline, readUsage, refreshApiUsage, uninstallStatusline } from "../platform/usage.js";
import { costReport } from "../sessions/costs.js";
import type { ServerModule } from "./module.js";

/** Consommation : limites de l'abonnement et coût des sessions. */
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
