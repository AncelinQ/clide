/**
 * Rattachement des onglets et des sessions à leur projet.
 *
 * Fonctions pures : le store les applique, les tests les exercent sans navigateur.
 */

/** Segments d'un chemin Windows ou POSIX, sans casse ni séparateur final. */
function segments(path: string): string[] {
  return path
    .replace(/[\\/]+$/, "")
    .split(/[\\/]+/)
    .map((segment) => segment.toLowerCase());
}

/** Vrai si `path` est `root` ou se trouve dessous, segment par segment. */
export function isInside(root: string, path: string): boolean {
  const parent = segments(root);
  const child = segments(path);
  if (child.length < parent.length) return false;
  return parent.every((segment, index) => segment === child[index]);
}

/**
 * Projet ouvert qui contient `path`, le plus profond l'emportant.
 *
 * Comparer par segments et non par préfixe : `C:\Projets\clide-docs` n'est pas
 * dans `C:\Projets\clide`. Sans projet qui le contienne, aucun : se rabattre sur
 * le projet actif rangerait un onglet d'ailleurs dans celui qu'on regarde.
 */
export function ownerOf(path: string, roots: readonly string[]): string | undefined {
  let best: string | undefined;
  for (const root of roots) {
    if (!isInside(root, path)) continue;
    if (!best || segments(root).length > segments(best).length) best = root;
  }
  return best;
}

/**
 * Onglet à montrer en entrant dans un projet : celui qu'on y regardait s'il est
 * encore ouvert, sinon le plus récent, sinon aucun — l'écran d'accueil.
 */
export function tabToShow(
  terminals: Record<string, { owner: string }>,
  lastTab: Record<string, string>,
  root: string,
): string | null {
  const own = Object.entries(terminals)
    .filter(([, entry]) => entry.owner === root)
    .map(([id]) => id);
  const remembered = lastTab[root];
  if (remembered && own.includes(remembered)) return remembered;
  return own.at(-1) ?? null;
}

/** L'onglet actif, seulement s'il appartient au projet actif. */
export function ownActiveTab(
  terminals: Record<string, { owner: string }>,
  activeTerminalId: string | null,
  activeRoot: string | null,
): string | undefined {
  if (!activeTerminalId || !activeRoot) return undefined;
  return terminals[activeTerminalId]?.owner === activeRoot ? activeTerminalId : undefined;
}
