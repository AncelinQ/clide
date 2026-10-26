/**
 * Ordre des onglets du centre d'un projet : identifiants de terminaux et chemins
 * de fichiers mêlés. L'ordre gardé peut nommer des onglets fermés depuis, et
 * ignorer ceux ouverts depuis : on le recolle à ce qui est là.
 */

/** Les onglets présents, dans l'ordre gardé ; les nouveaux à la fin, dans leur ordre d'ouverture. */
export function orderTabs(order: readonly string[], present: readonly string[]): string[] {
  const here = new Set(present);
  const known = order.filter((id) => here.has(id));
  const placed = new Set(known);
  return [...known, ...present.filter((id) => !placed.has(id))];
}

/** Place `id` juste devant `before`, ou à la fin sans `before`. */
export function moveTab(order: readonly string[], id: string, before: string | null): string[] {
  if (id === before) return [...order];
  const rest = order.filter((item) => item !== id);
  const index = before === null ? -1 : rest.indexOf(before);
  if (index === -1) return [...rest, id];
  return [...rest.slice(0, index), id, ...rest.slice(index)];
}

/** Décale `id` d'un cran à gauche (`-1`) ou à droite (`1`), sans faire le tour. */
export function shiftTab(order: readonly string[], id: string, step: -1 | 1): string[] {
  const index = order.indexOf(id);
  const target = index + step;
  if (index === -1 || target < 0 || target >= order.length) return [...order];
  const next = [...order];
  next[index] = next[target] as string;
  next[target] = id;
  return next;
}

/**
 * Côté où poser l'élément tiré quand le pointeur survole `target` pendant un
 * glisser, d'après l'ordre affiché et le sens du pointeur : `-1` vers le début,
 * `1` vers la fin, `0` immobile.
 *
 * Une cible plus loin, atteinte en avançant, est dépassée ; une cible plus tôt,
 * atteinte en reculant, aussi. Rien sinon : après un échange, un élément plus large
 * que l'élément tiré vient sous un pointeur qui n'a pas bougé, et ne doit pas
 * l'échanger en retour.
 */
export function aimFor(shown: readonly string[], dragged: string, target: string, dir: -1 | 0 | 1): "before" | "after" | undefined {
  const from = shown.indexOf(dragged);
  const to = shown.indexOf(target);
  if (from === -1 || to === -1 || from === to) return undefined;
  if (to > from && dir > 0) return "after";
  if (to < from && dir < 0) return "before";
  return undefined;
}

/** Place `id` lâché sur `target`, du côté où il est tombé. */
export function dropTab(order: readonly string[], id: string, target: string, side: "before" | "after"): string[] {
  if (id === target) return [...order];
  if (side === "before") return moveTab(order, id, target);
  const rest = order.filter((item) => item !== id);
  return moveTab(order, id, rest[rest.indexOf(target) + 1] ?? null);
}
