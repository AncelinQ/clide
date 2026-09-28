import { LinkStore, ScriptStore } from "@clide/core";

import { requireParam } from "../api/routes.js";
import type { ServerModule } from "./module.js";

/** Scripts du projet et de ses dossiers liés. */
export const scripts: ServerModule = {
  id: "scripts",
  routes: {
    /**
     * Scripts du projet et de ses dossiers liés. Chaque dossier lié garde son
     * gestionnaire : lancer ses scripts avec celui du projet réécrirait son arbre
     * de dépendances.
     */
    "/api/scripts": async (params) => {
      const root = requireParam(params, "root");
      const store = new ScriptStore();
      const links = await new LinkStore().read(root);
      const linked = await Promise.all(links.map((link) => store.read(link.path).catch(() => undefined)));
      return {
        ...(await store.read(root)),
        linked: linked.filter((item) => item !== undefined && item.sources.some((source) => source.scripts.length > 0)),
      };
    },
  },
};
