import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { TIP_CLASS } from "@/components/ui/tooltip";
import { TIP_DELAY_MS, TIP_GRACE_MS, TIP_SKIP_MS, anchorOf, placeTip, type TipRect, type TipSide } from "@/lib/tooltip";
import { cn } from "cn";

interface Tip {
  text: string;
  rect: TipRect;
  side: TipSide;
}

/** Un `title`, ou celui qu'on a mis de côté pendant le survol. */
const TITLED = "[title], [data-tip]";

function sideOf(element: Element): TipSide {
  const side = element.closest("[data-tip-side]")?.getAttribute("data-tip-side");
  return side === "left" || side === "right" ? side : "below";
}

/**
 * Infobulles de toute l'application, aux couleurs du thème : aucun `title` ne
 * s'affiche en infobulle native.
 *
 * Au survol d'un élément qui porte un `title`, celui-ci passe dans `data-tip`
 * avant que le navigateur ne lance la sienne, et lui est rendu dès que
 * l'infobulle se cache : le DOM ne diffère de ce que React a écrit que pendant le
 * survol, et un `title` que React retire après un clic ne revient pas périmé. Un
 * bouton qui ne tient son nom que de son `title` le garde dans `aria-label`
 * pendant ce temps. Le suivi se fait à chaque mouvement : un `title` qui apparaît
 * sous le pointeur, comme une erreur après un clic, est pris aussi.
 *
 * Au clavier, le `title` de l'élément qui reçoit un focus visible s'affiche de
 * même, sans être déplacé. Le pointeur peut passer sur l'infobulle sans la
 * perdre ; un clic, une touche — Échap comprise —, la molette ou le défilement de
 * ce qui la porte la cachent.
 *
 * Le gestionnaire de `keydown` est posé en capture sur `document` au montage,
 * avant ceux des fenêtres Radix : il passe le premier et peut garder Échap pour
 * lui.
 */
export function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let grace: ReturnType<typeof setTimeout> | undefined;
    /** L'élément dont l'infobulle est prévue ou affichée, et si c'est par le clavier. */
    let target: Element | null = null;
    let byFocus = false;
    /** L'élément dont le `title` est mis de côté, et s'il a fallu lui donner un nom. */
    let moved: { element: Element; labelled: boolean } | null = null;
    let visible = false;
    let hiddenAt = 0;
    let pointer = { x: 0, y: 0 };

    const putBack = () => {
      if (!moved) return;
      const { element, labelled } = moved;
      const text = element.getAttribute("data-tip");
      element.removeAttribute("data-tip");
      if (labelled) element.removeAttribute("aria-label");
      // Un `title` que React a réécrit pendant le survol l'emporte sur l'ancien.
      if (text !== null && !element.hasAttribute("title")) element.setAttribute("title", text);
      moved = null;
    };

    /** Met le `title` de côté ; il revient avec `putBack`. */
    const setAside = (element: Element) => {
      const title = element.getAttribute("title");
      if (title === null) return;
      element.setAttribute("data-tip", title);
      element.removeAttribute("title");
      if (moved?.element === element) return;
      const labelled =
        title.trim() !== "" &&
        !element.hasAttribute("aria-label") &&
        !element.hasAttribute("aria-labelledby") &&
        !element.textContent?.trim();
      if (labelled) element.setAttribute("aria-label", title);
      moved = { element, labelled };
    };

    const hide = () => {
      if (!target && !visible && !moved) return;
      clearTimeout(timer);
      clearTimeout(grace);
      grace = undefined;
      if (visible) hiddenAt = Date.now();
      visible = false;
      putBack();
      target = null;
      byFocus = false;
      setTip(null);
    };

    const schedule = (element: Element, keyboard: boolean) => {
      target = element;
      byFocus = keyboard;
      if (!keyboard) setAside(element);
      const wait = Date.now() - hiddenAt < TIP_SKIP_MS ? 0 : TIP_DELAY_MS;
      timer = setTimeout(() => {
        if (!element.isConnected) return hide();
        if (!keyboard) setAside(element);
        const text = element.getAttribute(keyboard ? "title" : "data-tip") ?? "";
        visible = text !== "";
        const rect = anchorOf(element.getBoundingClientRect(), keyboard ? undefined : pointer);
        setTip({ text, rect, side: sideOf(element) });
      }, wait);
    };

    const move = (event: MouseEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
      const node = event.target instanceof Element ? event.target : null;
      if (node && ref.current?.contains(node)) {
        clearTimeout(grace);
        grace = undefined;
        return;
      }
      const element = node?.closest(TITLED) ?? null;
      if (element && element === target && !byFocus) {
        clearTimeout(grace);
        grace = undefined;
        // Un `title` réécrit par React pendant le survol reste à l'écart.
        setAside(element);
        return;
      }
      if (!element) {
        if (byFocus) return;
        if (!visible) return hide();
        // Entre l'élément et son infobulle : un court répit pour l'atteindre.
        grace ??= setTimeout(hide, TIP_GRACE_MS);
        return;
      }
      hide();
      schedule(element, false);
    };

    const focus = (event: FocusEvent) => {
      const node = event.target instanceof Element ? event.target : null;
      if (!node || node.getAttribute("title") === null || !node.matches(":focus-visible")) return;
      hide();
      schedule(node, true);
    };

    const unfocus = (event: FocusEvent) => {
      if (byFocus && event.target === target) hide();
    };

    const key = (event: KeyboardEvent) => {
      // Échap sur l'élément focalisé ferme son infobulle et rien d'autre, comme
      // Radix. Au survol, elle passe : le pointeur posé sur un bouton
      // n'empêche pas d'interrompre Claude dans le terminal.
      if (event.key === "Escape" && visible && byFocus) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      hide();
    };

    const scroll = (event: Event) => {
      // Une sortie de terminal fait défiler sans cesse : seul compte ce qui porte
      // l'infobulle. Une infobulle encore à venir se place quand elle paraît : le
      // défilement qui amène l'élément focalisé en vue ne l'annule pas.
      if (visible && target && event.target instanceof Node && event.target.contains(target)) hide();
    };

    const root = document.documentElement;
    const dismissers = ["mousedown", "wheel", "dragstart"] as const;
    document.addEventListener("mousemove", move);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", unfocus);
    document.addEventListener("scroll", scroll, true);
    document.addEventListener("keydown", key, true);
    for (const type of dismissers) document.addEventListener(type, hide, true);
    root.addEventListener("mouseleave", hide);
    window.addEventListener("blur", hide);
    return () => {
      hide();
      document.removeEventListener("mousemove", move);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", unfocus);
      document.removeEventListener("scroll", scroll, true);
      document.removeEventListener("keydown", key, true);
      for (const type of dismissers) document.removeEventListener(type, hide, true);
      root.removeEventListener("mouseleave", hide);
      window.removeEventListener("blur", hide);
    };
  }, []);

  // Placée une fois mesurée, avant d'être peinte.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !tip) return;
    const { left, top } = placeTip({
      rect: tip.rect,
      width: node.offsetWidth,
      height: node.offsetHeight,
      side: tip.side,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    });
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
    node.style.visibility = "visible";
  }, [tip]);

  if (!tip?.text) return null;
  // Une fenêtre modale coupe le pointeur sur `body` : l'infobulle le reprend, pour rester survolable.
  return createPortal(
    <div ref={ref} role="tooltip" className={cn("pointer-events-auto invisible fixed top-0 left-0 z-[100]", TIP_CLASS)}>
      {tip.text}
    </div>,
    document.body,
  );
}
