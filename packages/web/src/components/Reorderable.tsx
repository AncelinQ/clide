import { useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from "react";

import { cn } from "cn";
import { aimFor } from "@/lib/tab-order";

/** Type de glisser propre à un groupe : un onglet ne se lâche que parmi les siens. */
const mime = (group: string) => `application/x-clide-${group.toLowerCase()}`;
/** Marque le glisser d'un contenant : lisible pendant le survol, quand son identifiant ne l'est pas. */
const HOLDER = "application/x-clide-holder";

/** Durée du glissement d'un élément vers sa nouvelle place. */
const SLIDE_MS = 160;

/** Un glisser en cours dans une liste. */
export interface Drag {
  /** L'élément tiré. */
  id: string;
  /** Il est l'étiquette d'un groupe : il se pose devant ou derrière un contenant, sans y entrer. */
  holder: boolean;
  /** La place visée, dont l'aperçu montre déjà l'effet. */
  aim?: { target: string; side: "before" | "after" };
  /** Le contenant survolé, où le lâcher le fera entrer : il s'entoure, l'aperçu ne bouge pas. */
  into?: string;
  /** Son emplacement se vide, une fois l'image du glisser prise par le navigateur. */
  lifted: boolean;
}

/** Les gestes d'une liste pour un ordre affiché donné. */
export interface ReorderList {
  drag: Drag | null;
  /** À poser sur le conteneur : un lâcher entre deux éléments garde l'aperçu. */
  zone: {
    onDragOver: (event: DragEvent<HTMLElement>) => void;
    onDrop: (event: DragEvent<HTMLElement>) => void;
  };
  item: (id: string, options?: { holds?: boolean; fixed?: boolean }) => ItemProps;
}

/** Le glisser une fois sorti du contenant qu'il survolait. */
function outside(drag: Drag): Drag {
  const next = { ...drag };
  delete next.into;
  return next;
}

type ItemProps = {
  ref: (element: HTMLElement | null) => void;
  draggable: boolean;
  "data-tab-id": string;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
};

/**
 * Rangement d'une liste au glisser-déposer, en direct : pendant qu'on tire un
 * élément, les autres s'écartent pour lui faire place et glissent vers leur
 * nouvelle place. Rien n'est enregistré avant le lâcher ; Échap, ou un lâcher
 * ailleurs, remet tout en place.
 *
 * La liste affiche l'aperçu elle-même : à partir de `drag.aim`, par la fonction
 * qui rangera au lâcher, puis passe l'ordre affiché à `bind`. L'élément survolé
 * est visé dans le sens où va le pointeur (`aimFor`).
 *
 * Les éléments doivent rester frères dans le DOM pendant le glisser : un élément
 * qui change de parent est démonté, et Chrome n'envoie plus `dragend` à la source
 * démontée.
 *
 * `axis` : une rangée (`x`, des onglets) ou une liste (`y`, des lignes).
 */
export function useReorder(group: string, onDrop: (moved: string, target: string, side: "before" | "after") => void, axis: "x" | "y" = "x") {
  const along = (event: { clientX: number; clientY: number }) => (axis === "x" ? event.clientX : event.clientY);
  const [drag, setDragState] = useState<Drag | null>(null);
  // Copie lue par les gestionnaires : `dragover` revient avant que React n'ait rendu le dernier changement.
  const current = useRef<Drag | null>(null);
  const elements = useRef(new Map<string, HTMLElement>());
  const before = useRef<Map<string, DOMRect> | null>(null);
  /** Dernière position du pointeur sur l'axe, et son sens : `-1` vers le début, `1` vers la fin. */
  const pointer = useRef<{ at: number; dir: -1 | 0 | 1 }>({ at: 0, dir: 0 });

  /** Change le glisser ; un changement qui déplace les éléments relève d'abord leur place. */
  const setDrag = (next: Drag | null, moves = true) => {
    if (moves) before.current = new Map([...elements.current].map(([id, element]) => [id, element.getBoundingClientRect()]));
    current.current = next;
    setDragState(next);
  };

  // Chaque élément déplacé part de son ancienne place, sans la transformation
  // qu'elle portait peut-être encore, et glisse jusqu'à la nouvelle.
  useLayoutEffect(() => {
    const was = before.current;
    before.current = null;
    if (!was || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (const [id, element] of elements.current) {
      const from = was.get(id);
      if (!from) continue;
      const to = element.getBoundingClientRect();
      const shift = axis === "x" ? from.left - to.left : from.top - to.top;
      if (Math.abs(shift) < 1) continue;
      element.style.transition = "none";
      element.style.transform = `${axis === "x" ? "translateX" : "translateY"}(${shift}px)`;
      void element.offsetWidth;
      element.style.transition = `transform ${SLIDE_MS}ms ease`;
      element.style.transform = "";
      element.addEventListener("transitionend", () => (element.style.transition = ""), { once: true });
    }
  });

  const accepts = (event: DragEvent<HTMLElement>) => current.current !== null && event.dataTransfer.types.includes(mime(group));
  const track = (event: DragEvent<HTMLElement>) => {
    const at = along(event);
    if (at !== pointer.current.at) pointer.current = { at, dir: at > pointer.current.at ? 1 : -1 };
  };
  const commit = () => {
    const done = current.current;
    if (done?.into) onDrop(done.id, done.into, "before");
    else if (done?.aim) onDrop(done.id, done.aim.target, done.aim.side);
    // Rendu avec l'ordre enregistré : l'aperçu et lui coïncident, rien ne saute.
    setDrag(null);
  };

  /**
   * Les gestes de la liste, pour `shown`, l'ordre affiché, aperçu compris.
   * `carried` : ce qui suit l'élément tiré, les onglets d'une étiquette de groupe.
   * Les survoler, c'est survoler l'élément tiré : ils ne sont pas une place où
   * aller, et l'aperçu reviendrait en arrière sous le pointeur.
   */
  const bind = (shown: readonly string[], carried: readonly string[] = []): ReorderList => ({
    drag,
    zone: {
      onDragOver: (event) => {
        if (!accepts(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        track(event);
      },
      onDrop: (event) => {
        if (!accepts(event)) return;
        event.preventDefault();
        commit();
      },
    },
    item: (id, { holds = false, fixed = false } = {}) => ({
      ref: (element) => {
        if (element) elements.current.set(id, element);
        else elements.current.delete(id);
      },
      draggable: !fixed,
      "data-tab-id": id,
      onDragStart: (event) => {
        event.dataTransfer.setData(mime(group), id);
        if (holds) event.dataTransfer.setData(HOLDER, "");
        event.dataTransfer.effectAllowed = "move";
        pointer.current = { at: along(event), dir: 0 };
        setDrag({ id, holder: holds, lifted: false }, false);
        // Pas tout de suite : le navigateur prend l'image du glisser à la fin de ce gestionnaire.
        setTimeout(() => {
          const now = current.current;
          if (now?.id === id) setDrag({ ...now, lifted: true }, false);
        });
      },
      onDragOver: (event) => {
        if (!accepts(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        track(event);
        const now = current.current;
        if (!now || id === now.id || carried.includes(id)) return;
        // Un onglet sur une étiquette y entrera : elle s'entoure, l'aperçu reste tel quel.
        if (holds && !now.holder) {
          if (now.into !== id) setDrag({ ...now, into: id }, false);
          return;
        }
        const side = aimFor(shown, now.id, id, pointer.current.dir);
        if (!side) {
          if (now.into) setDrag(outside(now), false);
          return;
        }
        if (now.aim?.target === id && now.aim.side === side && !now.into) return;
        setDrag({ ...outside(now), aim: { target: id, side } });
      },
      onDragLeave: (event) => {
        // Passer sur un enfant fait aussi sortir du parent : on ne s'en tient qu'à la vraie sortie.
        const now = current.current;
        if (now?.into !== id || event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDrag(outside(now), false);
      },
      onDrop: (event) => {
        if (!accepts(event)) return;
        event.preventDefault();
        event.stopPropagation();
        commit();
      },
      // Échap, ou un lâcher ailleurs : tout revient. Après un lâcher, il n'y a plus rien à défaire.
      onDragEnd: () => {
        if (current.current) setDrag(null);
      },
    }),
  });

  return { drag, bind };
}

/**
 * Un élément d'une liste rangée par `useReorder`. Son emplacement se vide pendant
 * qu'on le tire.
 *
 * `holds` en fait un contenant, l'étiquette d'un groupe : un élément lâché dessus
 * y entre, et il s'entoure au survol. Un autre contenant se pose devant ou derrière
 * lui. `fixed` le retient en place, le temps qu'on sélectionne du texte dans un
 * champ qu'il porte.
 */
export function ReorderItem({
  list,
  id,
  holds = false,
  fixed = false,
  className,
  children,
}: {
  list: ReorderList;
  id: string;
  holds?: boolean;
  fixed?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const lifted = list.drag?.id === id && list.drag.lifted;
  return (
    <div {...list.item(id, { holds, fixed })} className={cn("relative shrink-0", lifted && "invisible", className)}>
      {list.drag?.into === id && <span className="pointer-events-none absolute inset-0 z-10 rounded-lg ring-2 ring-primary" />}
      {children}
    </div>
  );
}

