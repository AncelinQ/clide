import { MemoStore } from "@clide/core";

import { requireParam } from "../api/routes.js";
import { moveToRecycleBin } from "../platform/trash.js";
import type { ServerModule } from "./module.js";

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

function rootOf(body: Record<string, unknown>): string {
  const root = text(body["root"]);
  if (!root) throw new Error("champ `root` manquant");
  return root;
}

/**
 * Le Mémo d'un projet : ses liens, ses notes et les fichiers qu'on y épingle,
 * gardés dans le dossier de données de Clide, jamais dans le projet.
 *
 * Le `root` des requêtes passe par la vérification commune des projets ouverts ;
 * un fichier épinglé doit lui aussi être dans un projet ouvert, ses dossiers liés
 * ou ses worktrees : l'éditeur n'ouvrirait rien d'autre.
 *
 * `trash` : la corbeille, remplacée dans les tests.
 */
export function memoModule(trash: (paths: string[], dataDir: string) => Promise<void> = moveToRecycleBin): ServerModule {
  // Un seul magasin par dossier de données : il met ses écritures bout à bout.
  const stores = new Map<string, MemoStore>();
  const storeOf = (dataDir: string): MemoStore => {
    let store = stores.get(dataDir);
    if (!store) {
      store = new MemoStore(dataDir, (paths) => trash(paths, dataDir));
      stores.set(dataDir, store);
    }
    return store;
  };

  return {
    id: "memo",
    routes: {
      "/api/memo": async (params, { dataDir }) => ({ memo: await storeOf(dataDir).load(requireParam(params, "root")) }),

      /** Les mémos de tous les projets qui en ont un, ouverts ou non, pour la vue d'ensemble. */
      "/api/memo/all": async (_params, { dataDir }) => ({ memos: await storeOf(dataDir).list() }),
    },
    mutations: {
      "/api/memo/links/put": async (_params, { dataDir }, body) => {
        const link = (typeof body["link"] === "object" && body["link"] !== null ? body["link"] : {}) as Record<string, unknown>;
        const replacing = text(body["replacing"]);
        return {
          link: await storeOf(dataDir).putLink(rootOf(body), { name: text(link["name"]), url: text(link["url"]) }, replacing || undefined),
        };
      },

      "/api/memo/links/remove": async (_params, { dataDir }, body) => {
        await storeOf(dataDir).removeLink(rootOf(body), text(body["url"]));
        return { ok: true };
      },

      "/api/memo/links/order": async (_params, { dataDir }, body) => {
        await storeOf(dataDir).orderLinks(rootOf(body), strings(body["urls"]));
        return { ok: true };
      },

      "/api/memo/pins/add": async (_params, { dataDir, workspace }, body) => {
        const root = rootOf(body);
        const paths = strings(body["paths"]);
        for (const path of paths) await workspace.resolve(path);
        return { added: await storeOf(dataDir).addPins(root, paths) };
      },

      "/api/memo/pins/remove": async (_params, { dataDir }, body) => {
        await storeOf(dataDir).removePin(rootOf(body), text(body["path"]));
        return { ok: true };
      },

      "/api/memo/pins/order": async (_params, { dataDir }, body) => {
        await storeOf(dataDir).orderPins(rootOf(body), strings(body["paths"]));
        return { ok: true };
      },

      "/api/memo/notes/create": async (_params, { dataDir }, body) => ({
        path: await storeOf(dataDir).newNote(rootOf(body), text(body["name"])),
      }),

      "/api/memo/notes/rename": async (_params, { dataDir }, body) => ({
        path: await storeOf(dataDir).renameNote(rootOf(body), text(body["path"]), text(body["name"])),
      }),

      "/api/memo/notes/trash": async (_params, { dataDir }, body) => {
        await storeOf(dataDir).trashNote(rootOf(body), text(body["path"]));
        return { ok: true };
      },
    },
  };
}

export const memo = memoModule();
