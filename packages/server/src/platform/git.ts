import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";

import { isInside, samePath } from "@claude-ide/core";

const run = promisify(execFile);

export interface Worktree {
  path: string;
  head?: string;
  /** Nom court de la branche, sans `refs/heads/`. Absent sur un HEAD détaché. */
  branch?: string;
  detached: boolean;
  bare: boolean;
  /** Verrouillé par git : `git worktree remove` refusera d'y toucher. */
  locked?: string;
  /** Git le considère supprimable — son dossier a disparu, par exemple. */
  prunable?: string;
  /** Le dépôt principal, celui dont les autres dérivent. */
  main: boolean;
}

export interface WorktreeDetails extends Worktree {
  /** Nombre de fichiers modifiés ou non suivis. `undefined` si l'état n'a pas pu être lu. */
  dirty?: number;
  ahead?: number;
  behind?: number;
}

/**
 * Analyse la sortie de `git worktree list --porcelain`.
 *
 * Le format est une suite de blocs séparés par une ligne vide, chaque bloc
 * commençant par `worktree <chemin>`. Les attributs sont des lignes à un ou deux
 * champs. Le **premier bloc est le dépôt principal** : c'est ce qui le distingue,
 * pas son chemin.
 */
export function parseWorktreeList(porcelain: string): Worktree[] {
  const worktrees: Worktree[] = [];
  let current: Worktree | undefined;

  const push = (): void => {
    if (current) worktrees.push(current);
    current = undefined;
  };

  for (const raw of porcelain.split("\n")) {
    const line = raw.trimEnd();
    if (line.length === 0) {
      push();
      continue;
    }
    const separator = line.indexOf(" ");
    const key = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? "" : line.slice(separator + 1);

    switch (key) {
      case "worktree":
        push();
        current = { path: value, detached: false, bare: false, main: worktrees.length === 0 };
        break;
      case "HEAD":
        if (current) current.head = value;
        break;
      case "branch":
        if (current) current.branch = value.replace(/^refs\/heads\//, "");
        break;
      case "detached":
        if (current) current.detached = true;
        break;
      case "bare":
        if (current) current.bare = true;
        break;
      case "locked":
        if (current) current.locked = value;
        break;
      case "prunable":
        if (current) current.prunable = value;
        break;
    }
  }
  push();
  return worktrees;
}


async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}

/**
 * Sujets des derniers commits d'un dépôt, du plus récent au plus ancien : un
 * message rédigé pour ce dépôt en reprend la langue et la convention. Un dossier
 * hors de git n'en a pas.
 */
export async function recentSubjects(cwd: string, count = 15): Promise<string[]> {
  try {
    return (await git(cwd, ["log", `-${count}`, "--format=%s"])).split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Forme canonique d'un chemin sur le disque.
 *
 * Git rend toujours sa propre résolution : un dossier atteint par un nom court
 * `ADM-A~1.QUI`, par une jonction ou dans une autre casse ressort sous sa forme
 * longue. Comparer ce que git dit à ce que l'application tient demande donc de
 * passer les deux par le système de fichiers.
 *
 * Un chemin disparu n'est pas résolvable : il est rendu tel quel, ce qui laisse
 * la comparaison échouer plutôt que lever.
 */
export async function realPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

/** Comparaison de chemins qui traverse les noms courts et les jonctions. */
export async function sameRealPath(a: string, b: string): Promise<boolean> {
  if (samePath(a, b)) return true;
  return samePath(await realPath(a), await realPath(b));
}

/**
 * Worktrees d'un dépôt, avec l'état de chacun.
 *
 * L'état — fichiers modifiés, avance et retard sur la branche amont — vient d'un
 * appel par worktree : c'est ce qui dit si un worktree est encore en cours ou
 * simplement oublié, et c'est la question qu'on se pose en ouvrant ce panneau.
 */
export class GitWorktrees {
  async list(projectRoot: string): Promise<Worktree[]> {
    try {
      return parseWorktreeList(await git(projectRoot, ["worktree", "list", "--porcelain"]));
    } catch {
      // Pas un dépôt git, ou git absent : aucun worktree à montrer.
      return [];
    }
  }

  async details(projectRoot: string): Promise<WorktreeDetails[]> {
    const worktrees = await this.list(projectRoot);
    return Promise.all(worktrees.map((worktree) => this.#detail(worktree)));
  }

  async #detail(worktree: Worktree): Promise<WorktreeDetails> {
    if (worktree.prunable) return worktree;

    const dirty = await this.#dirtyCount(worktree.path);
    const tracking = await this.#tracking(worktree.path);
    return {
      ...worktree,
      ...(dirty !== undefined ? { dirty } : {}),
      ...tracking,
    };
  }

  async #dirtyCount(path: string): Promise<number | undefined> {
    try {
      const output = await git(path, ["status", "--porcelain"]);
      return output.split("\n").filter((line) => line.trim().length > 0).length;
    } catch {
      return undefined;
    }
  }

  /** Avance et retard sur la branche amont. Sans amont, il n'y a rien à comparer. */
  async #tracking(path: string): Promise<{ ahead?: number; behind?: number }> {
    try {
      const output = await git(path, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]);
      const [ahead, behind] = output.trim().split(/\s+/).map(Number);
      if (!Number.isFinite(ahead) || !Number.isFinite(behind)) return {};
      return { ahead, behind };
    } catch {
      return {};
    }
  }

  /**
   * Retire un worktree.
   *
   * Trois refus, dans cet ordre : le dépôt principal, un chemin hors du projet,
   * un worktree qui porte du travail non commité. Le dernier n'est pas une
   * précaution de confort — `git worktree remove` sait le forcer, et ce forçage
   * n'est délibérément pas exposé : du travail perdu ici ne se retrouve nulle part.
   */
  async remove(projectRoot: string, worktreePath: string): Promise<{ removed: string }> {
    const worktrees = await this.list(projectRoot);

    let target: Worktree | undefined;
    for (const worktree of worktrees) {
      if (await sameRealPath(worktree.path, worktreePath)) {
        target = worktree;
        break;
      }
    }
    if (!target) throw new Error("ce worktree n'appartient pas à ce dépôt");
    if (target.main) throw new Error("le dépôt principal n'est pas un worktree à retirer");
    if (!isInside(await realPath(projectRoot), await realPath(target.path))) {
      throw new Error("ce worktree est hors du projet ; le retirer depuis un terminal");
    }

    const dirty = await this.#dirtyCount(target.path);
    if (dirty !== undefined && dirty > 0) {
      throw new Error(`${dirty} fichier(s) non commité(s) : à régler depuis un terminal`);
    }

    await git(projectRoot, ["worktree", "remove", target.path]);
    return { removed: target.path };
  }
}
