/**
 * Jeux de raccourcis et résolution d'une touche en commande.
 *
 * Clide est d'abord un terminal : les raccourcis par défaut sont des `Ctrl+Maj`
 * que ni PowerShell ni Claude Code n'utilisent. Un préréglage (VS Code,
 * JetBrains) y ajoute les touches de l'éditeur qu'on a dans les doigts ; celles
 * qui servent aussi au shell ou à Claude Code (`Ctrl+B`, `Ctrl+P`, `Ctrl+J`…) ne
 * valent que hors du terminal et des champs de saisie, où elles ne volent rien.
 */

export type Keymap = "clide" | "vscode" | "jetbrains";

export const KEYMAPS: readonly Keymap[] = ["clide", "vscode", "jetbrains"];

/** Où est le focus quand la touche arrive. L'éditeur de fichiers n'est pas un champ : ses touches sont celles d'un IDE. */
export type Focus = "terminal" | "input" | "editor" | "other";

export interface Binding {
  key: string;
  /** Seulement hors du terminal et des champs de saisie. */
  outside?: boolean;
}

/** Touches qu'un préréglage ajoute aux défauts, par commande. */
export const PRESETS: Record<Exclude<Keymap, "clide">, Record<string, Binding[]>> = {
  vscode: {
    palette: [{ key: "F1" }],
    "palette.files": [{ key: "Ctrl+P", outside: true }],
    "view.left": [{ key: "Ctrl+B", outside: true }],
    "session.toggle": [{ key: "Ctrl+J", outside: true }],
    "tab.next": [{ key: "Ctrl+PageDown", outside: true }],
    "tab.previous": [{ key: "Ctrl+PageUp", outside: true }],
    "tab.close": [{ key: "Ctrl+W", outside: true }],
    "tab.shell": [{ key: "Ctrl+Shift+`" }],
    "terminal.focus": [{ key: "Ctrl+`" }],
    preferences: [{ key: "Ctrl+,", outside: true }],
    "file.save": [{ key: "Ctrl+S", outside: true }],
  },
  jetbrains: {
    "palette.files": [{ key: "Ctrl+Shift+N", outside: true }],
    "view.left": [{ key: "Alt+1", outside: true }],
    "tab.next": [{ key: "Alt+ArrowRight", outside: true }],
    "tab.previous": [{ key: "Alt+ArrowLeft", outside: true }],
    "tab.close": [{ key: "Ctrl+F4", outside: true }],
    "terminal.focus": [{ key: "Alt+F12" }],
  },
};

/** Ce qu'il faut savoir d'une commande pour lui attribuer des touches. */
export interface Bindable {
  id: string;
  /** Raccourci par défaut, valable partout. */
  shortcut?: string;
}

/**
 * Touches d'une commande. Un raccourci choisi par l'utilisateur remplace tout —
 * défaut et préréglage — et vaut partout ; `null` retire toutes les touches.
 */
export function bindingsOf(
  command: Bindable,
  keymap: Keymap,
  overrides: Record<string, string | null>,
): Binding[] {
  if (command.id in overrides) {
    const chosen = overrides[command.id];
    return chosen ? [{ key: chosen }] : [];
  }
  const base = command.shortcut ? [{ key: command.shortcut }] : [];
  return keymap === "clide" ? base : [...base, ...(PRESETS[keymap][command.id] ?? [])];
}

export function applies(binding: Binding, focus: Focus): boolean {
  return !binding.outside || focus === "other" || focus === "editor";
}

/** La commande qu'une touche déclenche là où est le focus, s'il y en a une. */
export function commandFor(
  shortcut: string,
  focus: Focus,
  commands: readonly Bindable[],
  keymap: Keymap,
  overrides: Record<string, string | null>,
): string | undefined {
  return commands.find((command) =>
    bindingsOf(command, keymap, overrides).some((binding) => binding.key === shortcut && applies(binding, focus)),
  )?.id;
}

/**
 * Touches portées par plusieurs commandes à la fois. Deux liaisons se gênent dès
 * qu'un même focus les rend actives ensemble — hors du terminal, toutes le sont.
 */
export function conflicts(
  commands: readonly Bindable[],
  keymap: Keymap,
  overrides: Record<string, string | null>,
): { key: string; ids: string[] }[] {
  const byKey = new Map<string, string[]>();
  for (const command of commands) {
    for (const binding of bindingsOf(command, keymap, overrides)) {
      const ids = byKey.get(binding.key) ?? [];
      if (!ids.includes(command.id)) ids.push(command.id);
      byKey.set(binding.key, ids);
    }
  }
  return [...byKey.entries()].filter(([, ids]) => ids.length > 1).map(([key, ids]) => ({ key, ids }));
}

/** Où se trouve un élément du point de vue des raccourcis. */
export function focusOf(target: EventTarget | null): Focus {
  if (!(target instanceof Element)) return "other";
  if (target.closest(".xterm")) return "terminal";
  if (target.closest(".monaco-editor")) return "editor";
  if (target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']")) return "input";
  return "other";
}
