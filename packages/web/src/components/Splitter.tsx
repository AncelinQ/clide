import { useRef, useState } from "react";

import { t } from "@/i18n";
import { cn } from "cn";

/**
 * Poignée verticale qu'on tire pour élargir ou rétrécir ce qu'elle sépare.
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
}: {
  onStart: () => void;
  onDrag: (dx: number) => void;
  onEnd?: () => void;
  onReset: () => void;
  className?: string;
}) {
  const origin = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <>
      <div
        role="separator"
        aria-orientation="vertical"
        title={t("Tirer pour redimensionner, double-clic pour revenir à la largeur par défaut")}
        className={cn(
          "group relative w-1 shrink-0 cursor-col-resize touch-none",
          "after:absolute after:inset-y-2 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:rounded-full after:transition-colors",
          dragging ? "after:bg-primary" : "hover:after:bg-primary/50",
          className,
        )}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          origin.current = event.clientX;
          setDragging(true);
          onStart();
        }}
        onPointerMove={(event) => {
          if (origin.current !== null) onDrag(event.clientX - origin.current);
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
      {dragging && <div className="fixed inset-0 z-50 cursor-col-resize" />}
    </>
  );
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
