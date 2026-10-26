/**
 * Le clavier de la barre d'onglets du centre, un tablist à activation manuelle :
 * les flèches déplacent le focus sans rien montrer, Entrée montre. Seule l'entrée
 * qui montre l'onglet affiché est dans l'ordre de tabulation.
 */
import type { BarEntry } from "@/lib/tab-groups";

/**
 * L'entrée à focaliser après une touche : droite et gauche passent à la voisine en
 * bouclant aux deux bouts, Début et Fin vont à la première et à la dernière. Une
 * autre touche ne déplace rien.
 */
export function barMove(ids: readonly string[], focused: string | undefined, key: string): string | undefined {
  if (key === "Home") return ids[0];
  if (key === "End") return ids.at(-1);
  const step = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
  if (step === 0) return undefined;
  const index = focused === undefined ? -1 : ids.indexOf(focused);
  if (index === -1) return ids[0];
  return ids[(index + step + ids.length) % ids.length];
}

/**
 * L'entrée de la barre qui montre l'onglet `id` : l'onglet lui-même, ou l'étiquette
 * de son groupe replié. Rien pour un onglet absent de la barre, rangé dans Scripts.
 */
export function holderOf(entries: readonly BarEntry[], id: string | null | undefined): string | undefined {
  if (!id) return undefined;
  const entry = entries.find((item) => (item.kind === "tab" ? item.id === id : item.group.folded && item.ids.includes(id)));
  return entry?.id;
}
