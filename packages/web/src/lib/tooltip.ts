/**
 * Placement des infobulles : sous leur élément, ou à côté pour les barres
 * d'icônes, retournées quand la place manque et toujours dans la fenêtre.
 */

/** Où paraît une infobulle par rapport à son élément. */
export type TipSide = "below" | "left" | "right";

/** Survol avant qu'une infobulle paraisse : celui des infobulles Radix (`TooltipProvider` d'`App.tsx`). */
export const TIP_DELAY_MS = 400;
/** Passer d'une infobulle à une voisine dans ce délai l'affiche sans attendre, comme Radix. */
export const TIP_SKIP_MS = 300;
/** Temps laissé au pointeur qui quitte l'élément pour atteindre son infobulle. */
export const TIP_GRACE_MS = 150;

/** Écart entre l'élément et son infobulle. */
const GAP = 6;
/** Distance gardée aux bords de la fenêtre. */
const MARGIN = 4;

export interface TipRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, max));

/**
 * Coin haut gauche d'une infobulle de `width` × `height` pour l'élément `rect`.
 *
 * Sous l'élément, elle passe au-dessus si elle dépasserait en bas ; à côté,
 * elle passe de l'autre côté si elle dépasserait. Elle reste ensuite à
 * `MARGIN` des bords ; plus large que la fenêtre, elle colle au bord gauche.
 */
export function placeTip({
  rect,
  width,
  height,
  side,
  viewport,
}: {
  rect: TipRect;
  width: number;
  height: number;
  side: TipSide;
  viewport: { width: number; height: number };
}): { left: number; top: number } {
  let left: number;
  let top: number;
  if (side === "below") {
    left = rect.left + rect.width / 2 - width / 2;
    const below = rect.top + rect.height + GAP;
    top = below + height > viewport.height - MARGIN ? rect.top - GAP - height : below;
  } else {
    const right = rect.left + rect.width + GAP;
    const leftOf = rect.left - GAP - width;
    const fitsRight = right + width <= viewport.width - MARGIN;
    const fitsLeft = leftOf >= MARGIN;
    left = side === "right" ? (fitsRight || !fitsLeft ? right : leftOf) : fitsLeft || !fitsRight ? leftOf : right;
    top = rect.top + rect.height / 2 - height / 2;
  }
  return {
    left: clamp(left, MARGIN, viewport.width - width - MARGIN),
    top: clamp(top, MARGIN, viewport.height - height - MARGIN),
  };
}
