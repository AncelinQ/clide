/**
 * Recherche dans un terminal : couleurs des résultats et texte du compteur.
 */

type Rgb = [number, number, number];

/** Composantes d'une couleur telle qu'un canevas la rend : `#rrggbb`, ou `rgb(a)(r, g, b…)`. */
export function rgbOf(color: string): Rgb | undefined {
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim())?.[1];
  if (hex) return [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16)) as Rgb;
  const parts = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(color.trim());
  return parts ? [Number(parts[1]), Number(parts[2]), Number(parts[3])] : undefined;
}

function hexOf([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
}

/** `color` poussée vers `toward` de `amount` (0 : elle-même, 1 : l'autre). */
function mix(color: Rgb, toward: Rgb, amount: number): Rgb {
  return color.map((value, index) => value + ((toward[index] ?? value) - value) * amount) as Rgb;
}

export interface FindDecorations {
  matchBackground: string;
  matchOverviewRuler: string;
  activeMatchBackground: string;
  activeMatchBorder: string;
  activeMatchColorOverviewRuler: string;
}

/** Repli quand une couleur du thème ne se lit pas : un jaune de surligneur. */
const FALLBACK_ACCENT: Rgb = [0xe5, 0xb4, 0x00];
const FALLBACK_BACKGROUND: Rgb = [0x80, 0x80, 0x80];

/**
 * Surlignage des résultats, tiré de l'accent du thème fondu dans le fond du
 * terminal : assez pâle pour garder le texte lisible, le résultat courant plus
 * franc. xterm ne prend que du `#rrggbb`, sans transparence.
 *
 * Le résultat courant est aussi la sélection du terminal, peinte par-dessus son
 * fond : le contour d'accent, lui, passe au-dessus et le distingue des autres.
 */
export function findDecorations(accent: string, background: string): FindDecorations {
  const tint = rgbOf(accent) ?? FALLBACK_ACCENT;
  const ground = rgbOf(background) ?? FALLBACK_BACKGROUND;
  const solid = hexOf(tint);
  return {
    matchBackground: hexOf(mix(tint, ground, 0.7)),
    matchOverviewRuler: solid,
    activeMatchBackground: hexOf(mix(tint, ground, 0.35)),
    activeMatchBorder: solid,
    activeMatchColorOverviewRuler: solid,
  };
}

/** Où en est la recherche : rien tapé, expression invalide, ou les résultats. */
export type FindResult = { invalid: true } | { index: number; count: number };

/**
 * Le compteur de la barre. L'index vaut -1 quand les résultats dépassent ce que
 * le terminal surligne : on n'en connaît alors que le plafond.
 */
export function findStatus(result: FindResult | undefined): { text: string; values?: Record<string, number> } {
  if (!result) return { text: "" };
  if ("invalid" in result) return { text: "Expression invalide" };
  if (result.count === 0) return { text: "Aucun résultat" };
  if (result.index < 0) return { text: "Plus de {count}", values: { count: result.count } };
  return { text: "{index} sur {count}", values: { index: result.index + 1, count: result.count } };
}
