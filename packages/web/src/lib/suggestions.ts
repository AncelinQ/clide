/**
 * Suggestions en pastilles des invites de saisie : ce qu'on tape souvent, à
 * portée d'un clic. Fonctions pures ; la mémoire des réponses est à part.
 */

/**
 * Les préfixes les plus courants des branches d'un dépôt (`aqn/feat/`), du plus
 * au moins fréquent : un nom de branche commence presque toujours par l'un d'eux.
 * Seuls comptent ceux que portent au moins deux branches.
 */
export function branchPrefixes(branches: readonly string[], limit = 5): string[] {
  const counts = new Map<string, number>();
  for (const branch of branches) {
    const name = branch.replace(/^origin\//, "");
    const cut = name.lastIndexOf("/");
    if (cut <= 0) continue;
    const prefix = name.slice(0, cut + 1);
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([prefix]) => prefix);
}

/** Rôles usuels d'un dossier lié, proposés après ceux déjà donnés aux autres liens. */
export const COMMON_ROLES = ["api", "front", "back", "design system", "bibliothèque partagée", "documentation"];

/**
 * Les rôles à proposer : ceux des autres liens d'abord, puis les usuels (`common`,
 * traduits par l'appelant), sans doublon ni la valeur déjà tapée.
 */
export function roleSuggestions(used: readonly (string | undefined)[], current: string, common: readonly string[] = COMMON_ROLES, limit = 6): string[] {
  const seen = new Set<string>();
  const typed = current.trim().toLowerCase();
  const out: string[] = [];
  for (const role of [...used, ...common]) {
    const clean = role?.trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key) || key === typed) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= limit) break;
  }
  return out;
}

/** Ajoute une réponse en tête des dernières, sans doublon, bornée à `limit`. */
export function pushRecent(list: readonly string[], value: string, limit = 5): string[] {
  const clean = value.trim();
  if (!clean) return [...list];
  return [clean, ...list.filter((item) => item !== clean)].slice(0, limit);
}
