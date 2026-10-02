import { useState, type ReactNode } from "react";

import { cn } from "cn";

/** Type de glisser propre à un groupe : un onglet ne se lâche que parmi les siens. */
const mime = (group: string) => `application/x-clide-${group.toLowerCase()}`;

/**
 * Enveloppe un onglet qu'on range au glisser-déposer. Un trait vertical montre
 * la place d'arrivée ; Échap annule, comme tout glisser du navigateur.
 * `fixed` le retient en place, le temps qu'on sélectionne du texte dans un champ
 * qu'il porte.
 */
export function Reorderable({
  group,
  id,
  onDrop,
  fixed = false,
  children,
}: {
  group: string;
  id: string;
  onDrop: (moved: string, target: string, side: "before" | "after") => void;
  fixed?: boolean;
  children: ReactNode;
}) {
  const [side, setSide] = useState<"before" | "after">();
  const accepts = (types: readonly string[]) => types.includes(mime(group));
  return (
    <div
      draggable={!fixed}
      data-tab-id={id}
      className="relative shrink-0"
      onDragStart={(event) => {
        event.dataTransfer.setData(mime(group), id);
        event.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(event) => {
        if (!accepts(event.dataTransfer.types)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const box = event.currentTarget.getBoundingClientRect();
        setSide(event.clientX < box.left + box.width / 2 ? "before" : "after");
      }}
      onDragLeave={(event) => {
        // Passer sur un enfant fait aussi sortir du parent : on ne s'en tient qu'à la vraie sortie.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setSide(undefined);
      }}
      onDrop={(event) => {
        const moved = event.dataTransfer.getData(mime(group));
        const at = side;
        setSide(undefined);
        if (!moved || !at) return;
        event.preventDefault();
        if (moved !== id) onDrop(moved, id, at);
      }}
    >
      {side && <span className={cn("pointer-events-none absolute inset-y-0.5 z-10 w-0.5 rounded bg-primary", side === "before" ? "-left-[3px]" : "-right-[3px]")} />}
      {children}
    </div>
  );
}
