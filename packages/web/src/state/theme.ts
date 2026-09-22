import { getState, setState, type Theme } from "@/state/store";
import { applyTerminalTheme } from "@/state/terminals";

/** Noms xterm des seize couleurs ANSI, dans l'ordre de `--ansi-0` à `--ansi-15`. */
const ANSI = [
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow",
  "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
] as const;

const prefersDark = (): boolean => window.matchMedia("(prefers-color-scheme: dark)").matches;

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

export function applyTheme(): void {
  const { theme } = getState();
  const dark = theme === "dark" || (theme === "auto" && prefersDark());
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  applyTerminalTheme(terminalTheme());
}

export function cycleTheme(): void {
  const order: Theme[] = ["auto", "light", "dark"];
  const next = order[(order.indexOf(getState().theme) + 1) % order.length] ?? "auto";
  setState({ theme: next });
  applyTheme();
}

/** Suit l'apparence du système tant qu'aucun choix explicite n'a été fait. */
export function watchSystemTheme(): void {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (getState().theme === "auto") applyTheme();
  });
}
