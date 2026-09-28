import type { LucideIcon } from "lucide-react";

/**
 * Entrée d'un menu, décrite plutôt que dessinée : le même modèle sert au menu
 * déroulant d'un bouton et au menu contextuel, et une entrée ne se met en forme
 * qu'à un endroit.
 */
export type MenuItem =
  | {
      kind: "item";
      label: string;
      icon?: LucideIcon;
      /** Texte secondaire sous le libellé. */
      hint?: string;
      shortcut?: string;
      /** Coche devant le libellé ; `false` réserve la place pour aligner les voisines. */
      checked?: boolean;
      danger?: boolean;
      disabled?: boolean;
      run: () => void;
    }
  | { kind: "submenu"; label: string; icon?: LucideIcon; disabled?: boolean; items: MenuItem[] }
  | { kind: "label"; label: string }
  | { kind: "separator" };

/** Retire les séparateurs en tête, en fin et doublés : une section vide ne laisse pas de trait. */
export function tidy(items: MenuItem[]): MenuItem[] {
  const kept: MenuItem[] = [];
  for (const item of items) {
    if (item.kind === "separator" && (kept.length === 0 || kept.at(-1)?.kind === "separator")) continue;
    kept.push(item.kind === "submenu" ? { ...item, items: tidy(item.items) } : item);
  }
  while (kept.at(-1)?.kind === "separator") kept.pop();
  return kept;
}
