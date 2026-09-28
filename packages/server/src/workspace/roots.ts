import { resolve } from "node:path";

import { LinkStore, isInside, samePath } from "@clide/core";

import { GitWorktrees, realPath } from "../platform/git.js";

/** Un chemin demandé hors des dossiers ouverts. */
export class OutsideWorkspace extends Error {
  constructor(path: string) {
    super(`chemin hors des projets ouverts : ${path}`);
    this.name = "OutsideWorkspace";
  }
}

/** Dossiers qu'un projet ouvert rend accessibles en plus du sien. */
export type Expand = (root: string) => Promise<string[]>;

/** Dossiers liés du projet et worktrees de son dépôt. Un échec de lecture n'en retire que sa part. */
export const linkedAndWorktrees: Expand = async (root) => {
  const [links, worktrees] = await Promise.all([
    new LinkStore().read(root).catch(() => []),
    new GitWorktrees().list(root).catch(() => []),
  ]);
  return [...links.map((link) => link.path), ...worktrees.map((worktree) => worktree.path)];
};

/**
 * Dossiers où le serveur accepte de lire, d'écrire et de lancer des commandes.
 *
 * Le client dit quels projets sont ouverts ; le serveur en déduit lui-même ce
 * qui leur est attaché (dossiers liés, worktrees). Une route ne se fie donc plus
 * à la racine que lui envoie la requête pour borner un chemin : n'importe quelle
 * racine passerait. Les chemins sont comparés une fois résolus (`realpath`), pour
 * qu'une jonction posée dans un projet ne mène pas ailleurs.
 */
export class WorkspaceRoots {
  #open: string[] = [];
  #allowed: string[] = [];
  #pending: Promise<void> = Promise.resolve();

  constructor(private readonly expand: Expand = linkedAndWorktrees) {}

  /** Projets ouverts dans l'interface, tels que le client les a envoyés. */
  get open(): readonly string[] {
    return this.#open;
  }

  /** Remplace les projets ouverts et recalcule ce qu'ils rendent accessible. */
  update(roots: readonly string[]): Promise<void> {
    const open = roots.filter((root) => typeof root === "string" && root.length > 0).map((root) => resolve(root));
    this.#open = open;
    // Deux mises à jour rapprochées : la dernière l'emporte, jamais un calcul
    // plus ancien qui finirait après elle.
    const run = this.#pending.then(() => this.#compute(open));
    this.#pending = run.catch(() => undefined);
    return run;
  }

  /** Recalcule pour les mêmes projets : un lien ou un worktree vient d'être ajouté ou retiré. */
  refresh(): Promise<void> {
    return this.update(this.#open);
  }

  async #compute(open: string[]): Promise<void> {
    const attached = await Promise.all(open.map((root) => this.expand(root)));
    const all = [...open, ...attached.flat()].map((path) => resolve(path));
    const real = await Promise.all(all.map((path) => realPath(path)));
    if (open !== this.#open) return;
    this.#allowed = dedupe([...all, ...real]);
  }

  /** Vrai si `path` est un dossier autorisé ou se trouve dessous, sans résoudre les liens. */
  contains(path: string): boolean {
    const absolute = resolve(path);
    return this.#allowed.some((root) => samePath(root, absolute) || isInside(root, absolute));
  }

  /**
   * Rend `path` absolu s'il est dans un dossier autorisé, une fois ses liens
   * résolus ; sinon lève `OutsideWorkspace`. Un chemin qui n'existe pas encore
   * (un fichier à créer) est jugé sur sa forme écrite.
   */
  async resolve(path: string): Promise<string> {
    await this.#pending;
    const absolute = resolve(path);
    if (!this.contains(absolute)) throw new OutsideWorkspace(path);
    const real = await realPath(absolute);
    if (!this.contains(real)) throw new OutsideWorkspace(path);
    return absolute;
  }
}

/**
 * Vérifie les racines qu'une requête désigne : le paramètre `root`, et dans le
 * corps `root` et `roots`. Toutes les routes qui agissent sur un projet le
 * nomment ainsi ; les borner ici évite d'en oublier une.
 */
export async function checkRoots(
  workspace: WorkspaceRoots,
  params: URLSearchParams,
  body: Record<string, unknown> = {},
): Promise<void> {
  const named: unknown[] = [params.get("root"), body["root"]];
  if (Array.isArray(body["roots"])) named.push(...(body["roots"] as unknown[]));
  for (const root of named) {
    if (typeof root === "string" && root.length > 0) await workspace.resolve(root);
  }
}

function dedupe(paths: string[]): string[] {
  const kept: string[] = [];
  for (const path of paths) if (!kept.some((known) => samePath(known, path))) kept.push(path);
  return kept;
}
