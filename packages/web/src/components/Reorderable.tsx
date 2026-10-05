import { useState, type ReactNode } from "react";

import { cn } from "cn";

/** Type de glisser propre à un groupe : un onglet ne se lâche que parmi les siens. */
const mime = (group: string) => `application/x-clide-${group.toLowerCase()}`;
/** Marque le glisser d'un contenant : lisible pendant le survol, quand son identifiant ne l'est pas. */
const HOLDER = "application/x-clide-holder";

/**
 * Enveloppe un onglet qu'on range au glisser-déposer. Un trait vertical montre
 * la place d'arrivée ; Échap annule, comme tout glisser du navigateur.
 * `fixed` le retient en place, le temps qu'on sélectionne du texte dans un champ
 * qu'il porte.
 *
 * `holds` en fait un contenant, l'étiquette d'un groupe : ce qu'on y lâche y entre,
 * et c'est lui qui s'entoure plutôt qu'un trait sur un côté. Un autre contenant se
 * pose devant ou derrière lui. Le côté reste transmis : c'est `onDrop` qui décide.
 */
export function Reorderable({
  group,
  id,
  onDrop,
  fixed = false,
  holds = false,
  children,
}: {
  group: string;
  id: string;
  onDrop: (moved: string, target: string, side: "before" | "after") => void;
  fixed?: boolean;
  holds?: boolean;
  children: ReactNode;
}) {
  const [aim, setAim] = useState<{ side: "before" | "after"; into: boolean }>();
  const accepts = (types: readonly string[]) => types.includes(mime(group));
  return (
    <div
      draggable={!fixed}
      data-tab-id={id}
      className="relative shrink-0"
      onDragStart={(event) => {
        event.dataTransfer.setData(mime(group), id);
        if (holds) event.dataTransfer.setData(HOLDER, "");
        event.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(event) => {
        if (!accepts(event.dataTransfer.types)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const box = event.currentTarget.getBoundingClientRect();
        const side = event.clientX < box.left + box.width / 2 ? "before" : "after";
        const into = holds && !event.dataTransfer.types.includes(HOLDER);
        if (aim?.side !== side || aim.into !== into) setAim({ side, into });
      }}
      onDragLeave={(event) => {
        // Passer sur un enfant fait aussi sortir du parent : on ne s'en tient qu'à la vraie sortie.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setAim(undefined);
      }}
      onDrop={(event) => {
        const moved = event.dataTransfer.getData(mime(group));
        const at = aim?.side;
        setAim(undefined);
        if (!moved || !at) return;
        event.preventDefault();
        if (moved !== id) onDrop(moved, id, at);
      }}
    >
      {aim?.into ? (
        <span className="pointer-events-none absolute inset-0 z-10 rounded-lg ring-2 ring-primary" />
      ) : (
        aim && (
          <span
            className={cn("pointer-events-none absolute inset-y-0.5 z-10 w-0.5 rounded bg-primary", aim.side === "before" ? "-left-[3px]" : "-right-[3px]")}
          />
        )
      )}
      {children}
    </div>
  );
}
