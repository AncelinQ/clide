import { getState, setState, type InterfaceFont } from "@/state/store";

/**
 * Police et échelle de l'interface, à part de celles du terminal et de l'éditeur.
 *
 * Presque toutes les tailles de l'interface sont en pixels : changer la taille de
 * base ne les toucherait pas. Dans l'application de bureau, l'échelle passe par le
 * zoom d'Electron, qui garde menus flottants et coordonnées justes ; le terminal et
 * l'éditeur divisent leur taille de police par elle pour garder la leur. Dans un
 * navigateur, un `zoom` CSS sur `#root` en tient lieu, dont le terminal et
 * l'éditeur se retirent (`data-unzoom`) ; les menus, rendus hors de `#root`,
 * restent à leur taille, mais à leur place.
 */

type Listener = () => void;
const listeners = new Set<Listener>();

/** Échelle appliquée par Electron, que le terminal et l'éditeur compensent ; 1 dans un navigateur. */
export function nativeZoom(): number {
  return window.clide?.setZoom ? getState().uiFont.scale / 100 : 1;
}

/** Prévient le terminal et l'éditeur quand l'échelle change. */
export function onZoomChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function applyInterfaceFont(font: InterfaceFont = getState().uiFont): void {
  const root = document.documentElement;
  if (font.family) root.style.setProperty("--ui-font", `"${font.family.replace(/"/g, "")}"`);
  else root.style.removeProperty("--ui-font");
  const zoom = font.scale / 100;
  const app = document.querySelector<HTMLElement>("#root");
  if (window.clide?.setZoom) {
    window.clide.setZoom(zoom);
    root.style.setProperty("--ui-zoom", "1");
    if (app) app.style.zoom = "";
  } else {
    root.style.setProperty("--ui-zoom", String(zoom));
    if (app) app.style.zoom = zoom === 1 ? "" : String(zoom);
  }
  for (const listener of listeners) listener();
}

export function setInterfaceFont(font: InterfaceFont): void {
  setState({ uiFont: font });
  applyInterfaceFont(font);
}
