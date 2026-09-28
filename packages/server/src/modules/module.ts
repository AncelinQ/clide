import type { ApiContext, Handler, Mutation } from "../api/routes.js";

/**
 * Un module du serveur : les routes d'une fonction de Clide qui peut s'activer
 * ou non dans l'interface (la consommation, les scripts…). Le contrat sert à
 * découper, pas à isoler : un module est compilé avec l'application et reçoit le
 * même contexte que les autres routes.
 *
 * Désactiver un module est une affaire d'interface : ses routes restent
 * montées, rien ne les appelle plus.
 */
export interface ServerModule {
  id: string;
  /** Lectures, par chemin complet (`/api/usage`). */
  routes?: Record<string, Handler>;
  /** Routes qui agissent, réservées à POST. */
  mutations?: Record<string, Mutation>;
  /** Appelé une fois, au démarrage du serveur : le module s'abonne à ce qu'il suit. */
  start?: (context: ApiContext) => void;
  /** Appelé à l'arrêt du serveur : le module libère ce qu'il a lancé. */
  stop?: () => Promise<void> | void;
}

export interface RouteTable {
  routes: Record<string, Handler>;
  mutations: Record<string, Mutation>;
}

/**
 * Ajoute les routes des modules à celles de base. Deux déclarations d'un même
 * chemin sont une erreur de construction : la seconde masquerait la première
 * sans bruit, et l'on ne saurait plus laquelle répond.
 */
export function mountModules(base: RouteTable, modules: readonly ServerModule[]): RouteTable {
  const routes = { ...base.routes };
  const mutations = { ...base.mutations };
  const owner = new Map<string, string>();
  for (const path of [...Object.keys(routes), ...Object.keys(mutations)]) owner.set(path, "base");

  for (const module of modules) {
    for (const [table, entries] of [
      [routes, module.routes ?? {}],
      [mutations, module.mutations ?? {}],
    ] as const) {
      for (const [path, handler] of Object.entries(entries)) {
        if (!path.startsWith("/api/")) throw new Error(`module ${module.id} : route hors de /api/ (${path})`);
        const previous = owner.get(path);
        if (previous) throw new Error(`route ${path} déclarée par ${previous} et par le module ${module.id}`);
        owner.set(path, module.id);
        (table as Record<string, Handler | Mutation>)[path] = handler;
      }
    }
  }
  return { routes, mutations };
}
