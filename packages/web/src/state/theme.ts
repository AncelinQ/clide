import { useSyncExternalStore } from "react";

import { canvasIsDark, isDark, type Look } from "@/lib/looks";
import type { ImportedTheme } from "@/lib/vscode-theme";
import { setEditorTheme } from "@/state/editor";
import { getState, setState, useStore, type Theme } from "@/state/store";
import { applyTerminalTheme } from "@/state/terminals";

/** Noms xterm des seize couleurs ANSI, dans l'ordre de `--ansi-0` à `--ansi-15`. */
const ANSI = [
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow",
  "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
] as const;

export type Mode = "light" | "dark";

const systemDark = (): MediaQueryList => window.matchMedia("(prefers-color-scheme: dark)");

/** Mode affiché : celui choisi, ou celui du système quand on le suit. */
export function effectiveMode(theme: Theme = getState().theme): Mode {
  return theme === "dark" || (theme === "auto" && systemDark().matches) ? "dark" : "light";
}

/** Réabonne un composant au mode affiché, y compris quand le système en change. */
export function useEffectiveMode(): Mode {
  const theme = useStore((state) => state.theme);
  const dark = useSyncExternalStore(
    (notify) => {
      const media = systemDark();
      media.addEventListener("change", notify);
      return () => media.removeEventListener("change", notify);
    },
    () => systemDark().matches,
  );
  return theme === "auto" ? (dark ? "dark" : "light") : theme;
}

/**
 * Couleurs du terminal, relues depuis la feuille de style.
 *
 * Les définir ici les dupliquerait : elles vivent dans le CSS avec le reste du
 * thème, et xterm ne sait pas les y lire tout seul.
 */
export function terminalTheme(): Record<string, string> {
  const styles = getComputedStyle(document.documentElement);
  const read = (name: string): string => styles.getPropertyValue(name).trim();
  const theme: Record<string, string> = {
    background: read("--term-bg"),
    foreground: read("--term-fg"),
    cursor: read("--term-fg"),
  };
  ANSI.forEach((name, index) => {
    theme[name] = read(`--ansi-${index}`);
  });
  return theme;
}

/**
 * Pose l'habillage sur la racine : la toile, et l'accent dont la feuille de style
 * tire l'anneau de focus et le fond de survol.
 *
 * L'encre — le texte posé sur la toile ou sur un bouton d'accent — est choisie
 * ici, claire ou sombre selon la couleur en dessous : la feuille de style ne sait
 * pas le décider seule.
 */
function applyLook(look: Look): void {
  const root = document.documentElement;
  root.style.setProperty("--canvas", look.canvas);
  root.style.setProperty("--canvas-end", look.canvasEnd ?? look.canvas);
  root.style.setProperty("--canvas-angle", `${look.angle}deg`);
  root.style.setProperty("--primary", look.accent);
  root.style.setProperty("--primary-foreground", isDark(look.accent) ? "var(--ink-on-dark)" : "var(--ink-on-light)");
  root.dataset["canvas"] = canvasIsDark(look) ? "dark" : "light";
}

/** Variables posées par le thème importé, à retirer quand il change ou s'en va. */
let importedVars: string[] = [];

/**
 * Pose un thème VS Code importé par-dessus l'habillage : ses jetons remplacent
 * ceux de la feuille de style, ceux qu'il ne donne pas gardent la valeur de Clide.
 */
function applyImported(theme: ImportedTheme): void {
  const root = document.documentElement;
  for (const [name, color] of Object.entries(theme.vars)) {
    root.style.setProperty(name, color);
    importedVars.push(name);
  }
  const primary = theme.vars["--primary"];
  if (primary && !theme.vars["--primary-foreground"]) {
    root.style.setProperty("--primary-foreground", isDark(primary.slice(0, 7)) ? "var(--ink-on-dark)" : "var(--ink-on-light)");
  }
  const canvas = theme.vars["--canvas"];
  if (canvas) root.dataset["canvas"] = isDark(canvas.slice(0, 7)) ? "dark" : "light";
}

export function applyTheme(): void {
  const { look, vscodeTheme } = getState();
  const root = document.documentElement;
  for (const name of importedVars) root.style.removeProperty(name);
  importedVars = [];
  // Un thème importé porte son mode : le choix clair, sombre ou système s'efface devant lui.
  const mode = vscodeTheme ? vscodeTheme.mode : effectiveMode();
  root.classList.toggle("dark", mode === "dark");
  root.style.colorScheme = mode;
  applyLook(look[mode]);
  if (vscodeTheme) applyImported(vscodeTheme);
  setEditorTheme(vscodeTheme?.editor ?? null);
  applyTerminalTheme(terminalTheme());
}

/** Importe un thème VS Code, ou le retire avec `null`. */
export function setImportedTheme(theme: ImportedTheme | null): void {
  setState({ vscodeTheme: theme });
  applyTheme();
}

export function setTheme(theme: Theme): void {
  setState({ theme });
  applyTheme();
}

export function cycleTheme(): void {
  const order: Theme[] = ["auto", "light", "dark"];
  setTheme(order[(order.indexOf(getState().theme) + 1) % order.length] ?? "auto");
}

/** Suit l'apparence du système tant qu'aucun choix explicite n'a été fait. */
export function watchSystemTheme(): void {
  systemDark().addEventListener("change", () => {
    if (getState().theme === "auto") applyTheme();
  });
}
