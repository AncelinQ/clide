import { useRef, useState } from "react";

import { t } from "@/i18n";
import { cn } from "cn";

/**
 * Poignée qu'on tire pour élargir ou rétrécir ce qu'elle sépare : verticale entre
 * deux colonnes, horizontale entre deux îlots empilés.
 *
 * `onDrag` reçoit le déplacement depuis le début du geste, pas depuis le dernier
 * mouvement : le parent repart de la largeur qu'il avait au clic, et une valeur
 * bornée ne dérive pas. Un voile couvre la fenêtre pendant le geste — un cadre
 * d'aperçu avalerait sinon les mouvements de la souris qui passe dessus. Un
 * double-clic rend la largeur par défaut.
 */
export function Splitter({
  onStart,
  onDrag,
  onEnd,
  onReset,
  className,
  orientation = "vertical",
}: {
  onStart: () => void;
  /** Déplacement depuis le début du geste : horizontal pour une poignée verticale, vertical sinon. */
  onDrag: (delta: number) => void;
  onEnd?: () => void;
  onReset: () => void;
  className?: string;
  orientation?: "vertical" | "horizontal";
}) {
  const origin = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const vertical = orientation === "vertical";
  const position = (event: { clientX: number; clientY: number }) => (vertical ? event.clientX : event.clientY);

  return (
    <>
      <div
        role="separator"
        aria-orientation={orientation}
        title={
          vertical
            ? t("Tirer pour redimensionner, double-clic pour revenir à la largeur par défaut")
            : t("Tirer pour redimensionner, double-clic pour revenir à la hauteur par défaut")
        }
        className={cn(
          "group relative shrink-0 touch-none after:absolute after:rounded-full after:transition-colors",
          vertical
            ? "w-1 cursor-col-resize after:inset-y-2 after:left-1/2 after:w-0.5 after:-translate-x-1/2"
            : "h-1 cursor-row-resize after:inset-x-2 after:top-1/2 after:h-0.5 after:-translate-y-1/2",
          dragging ? "after:bg-primary" : "hover:after:bg-primary/50",
          className,
        )}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          origin.current = position(event);
          setDragging(true);
          onStart();
        }}
        onPointerMove={(event) => {
          if (origin.current !== null) onDrag(position(event) - origin.current);
        }}
        onPointerUp={(event) => {
          if (origin.current === null) return;
          event.currentTarget.releasePointerCapture(event.pointerId);
          origin.current = null;
          setDragging(false);
          onEnd?.();
        }}
        onDoubleClick={onReset}
      />
      {dragging && <div className={cn("fixed inset-0 z-50", vertical ? "cursor-col-resize" : "cursor-row-resize")} />}
    </>
  );
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
