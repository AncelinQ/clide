import { LinkStore, ScriptStore, readGroups, writeGroups, type ScriptGroup } from "@clide/core";

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
        linked: linked.filter(
          (item) => item !== undefined && (item.sources.some((source) => source.scripts.length > 0) || item.tools.length > 0),
        ),
      };
    },

    /** Groupes de scripts du projet, lancés ensemble. */
    "/api/scripts/groups": async (params) => ({ groups: await readGroups(requireParam(params, "root")) }),
  },
  mutations: {
    /** Remplace les groupes du projet : l'interface envoie la liste entière, dans son ordre. */
    "/api/scripts/groups/save": async (_params, _context, body) => {
      const root = typeof body["root"] === "string" ? body["root"] : "";
      if (!root) throw new Error("champ `root` manquant");
      const groups = Array.isArray(body["groups"]) ? (body["groups"] as ScriptGroup[]) : [];
      await writeGroups(root, groups);
      return { groups: await readGroups(root) };
    },
  },
};
