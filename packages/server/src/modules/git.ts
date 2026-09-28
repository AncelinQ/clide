import { readFile } from "node:fs/promises";

import { graphRows, resolveInside } from "@clide/core";

import { requireParam } from "../api/routes.js";
import { gitChanges, gitCommit, gitFileAt, gitLog, gitShow, lastCommitMessage } from "../platform/git-actions.js";
import type { ServerModule } from "./module.js";

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];

/**
 * Git : les modifications à commiter, le commit, le journal et le détail d'un
 * commit, les deux versions d'un fichier pour les diffs. La racine de chaque
 * requête est vérifiée au dispatch, comme pour toute route qui nomme un projet.
 */
export const gitModule: ServerModule = {
  id: "git",
  routes: {
    "/api/git/changes": async (params) => ({ changes: await gitChanges(requireParam(params, "root")) }),

    "/api/git/last-message": async (params) => ({ message: await lastCommitMessage(requireParam(params, "root")) }),

    /** Journal de toutes les branches, avec les voies du graphe déjà calculées. */
    "/api/git/log": async (params) => {
      const limit = Math.min(Number(params.get("limit") ?? 300) || 300, 2000);
      const commits = await gitLog(requireParam(params, "root"), limit);
      return { commits, rows: graphRows(commits) };
    },

    "/api/git/show": async (params) => gitShow(requireParam(params, "root"), requireParam(params, "hash")),

    /**
     * Les deux côtés d'un diff. `ref=worktree` : le dernier commit contre le
     * fichier sur disque ; un hash : son parent contre lui. Un fichier ajouté a
     * un côté vide, un supprimé aussi.
     */
    "/api/git/diff": async (params) => {
      const root = requireParam(params, "root");
      const path = requireParam(params, "path");
      const from = params.get("from") || path;
      const ref = params.get("ref") || "worktree";
      if (ref === "worktree") {
        // Borné au dépôt : la racine est vérifiée au dispatch, le chemin qui s'y ajoute ne l'est qu'ici.
        const modified = await readFile(resolveInside(root, path), "utf8").catch(() => "");
        return { original: await gitFileAt(root, "HEAD", from), modified };
      }
      return { original: await gitFileAt(root, `${ref}^`, from), modified: await gitFileAt(root, ref, path) };
    },
  },
  mutations: {
    /** Commite les fichiers cochés, et eux seuls, avec leur contenu sur disque. */
    "/api/git/commit": async (_params, _context, body) => {
      const root = typeof body["root"] === "string" ? body["root"] : "";
      if (!root) throw new Error("champ `root` manquant");
      const message = typeof body["message"] === "string" ? body["message"] : "";
      return {
        head: await gitCommit(root, {
          message,
          paths: strings(body["paths"]),
          untracked: strings(body["untracked"]),
          amend: body["amend"] === true,
        }),
      };
    },
  },
};
