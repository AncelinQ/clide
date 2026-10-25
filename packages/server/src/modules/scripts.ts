import { LinkStore, ScriptStore, readGroups, samePath, writeGroups, type ProjectScripts, type ScriptGroup } from "@clide/core";

import { requireParam } from "../api/routes.js";
import { GitWorktrees, realPath } from "../platform/git.js";
import type { ServerModule } from "./module.js";

/** Un dossier a quelque chose à lancer : un script npm ou une commande d'outil. */
function runnable<T extends ProjectScripts>(item: T | undefined): item is T {
  return item !== undefined && (item.sources.some((source) => source.scripts.length > 0) || item.tools.length > 0);
}

/** Scripts du projet, de ses dossiers liés et des autres worktrees de son dépôt. */
export const scripts: ServerModule = {
  id: "scripts",
  routes: {
    /**
     * Scripts du projet, de ses dossiers liés et des autres worktrees de son
     * dépôt. Chaque dossier garde son gestionnaire : lancer ses scripts avec celui
     * du projet réécrirait son arbre de dépendances. Un worktree déjà lié n'est
     * montré qu'une fois, parmi les dossiers liés.
     */
    "/api/scripts": async (params) => {
      const root = requireParam(params, "root");
      const store = new ScriptStore();
      const [links, worktrees, here] = await Promise.all([new LinkStore().read(root), new GitWorktrees().list(root), realPath(root)]);
      // Git donne des chemins résolus : le projet se reconnaît une fois le sien résolu aussi.
      const others = worktrees.filter(
        (worktree) => !worktree.bare && !worktree.prunable && !samePath(worktree.path, here) && !links.some((link) => samePath(link.path, worktree.path)),
      );
      const [linked, branches] = await Promise.all([
        Promise.all(links.map((link) => store.read(link.path).catch(() => undefined))),
        Promise.all(
          others.map(async (worktree) => {
            const found = await store.read(worktree.path).catch(() => undefined);
            return found && { ...found, ...(worktree.branch ? { branch: worktree.branch } : {}), main: worktree.main };
          }),
        ),
      ]);
      return {
        ...(await store.read(root)),
        linked: linked.filter(runnable),
        worktrees: branches.filter(runnable),
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
