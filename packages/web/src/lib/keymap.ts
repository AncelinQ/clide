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
  /** Seulement dans un terminal qui a le focus, où elle passe devant les autres commandes. */
  terminal?: boolean;
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
    "tab.scripts": [{ key: "Alt+4", outside: true }],
    "terminal.focus": [{ key: "Alt+F12" }],
  },
};

/** Ce qu'il faut savoir d'une commande pour lui attribuer des touches. */
export interface Bindable {
  id: string;
  /** Raccourci par défaut, valable partout. */
  shortcut?: string;
  /**
   * `terminal` : une action sur le terminal qui a le focus. Ses touches ne valent
   * que là, et y passent devant celles des autres commandes, qui gardent les
   * mêmes partout ailleurs.
   */
  scope?: "terminal";
}

/**
 * Touches d'une commande. Un raccourci choisi par l'utilisateur remplace tout —
 * défaut et préréglage — et vaut partout où vaut la commande ; `null` retire
 * toutes les touches.
 */
export function bindingsOf(
  command: Bindable,
  keymap: Keymap,
  overrides: Record<string, string | null>,
): Binding[] {
  const bindings = ownBindings(command, keymap, overrides);
  return command.scope === "terminal" ? bindings.map((binding) => ({ ...binding, terminal: true })) : bindings;
}

function ownBindings(command: Bindable, keymap: Keymap, overrides: Record<string, string | null>): Binding[] {
  if (command.id in overrides) {
    const chosen = overrides[command.id];
    return chosen ? [{ key: chosen }] : [];
  }
  const base = command.shortcut ? [{ key: command.shortcut }] : [];
  return keymap === "clide" ? base : [...base, ...(PRESETS[keymap][command.id] ?? [])];
}

export function applies(binding: Binding, focus: Focus): boolean {
  if (binding.terminal) return focus === "terminal";
  return !binding.outside || focus === "other" || focus === "editor";
}

/** Deux commandes dont les touches peuvent se gêner : même portée. */
export function sameScope(a: Bindable, b: Bindable): boolean {
  return a.scope === b.scope;
}

/** La commande qu'une touche déclenche là où est le focus, s'il y en a une. */
export function commandFor(
  shortcut: string,
  focus: Focus,
  commands: readonly Bindable[],
  keymap: Keymap,
  overrides: Record<string, string | null>,
): string | undefined {
  const matching = commands.filter((command) =>
    bindingsOf(command, keymap, overrides).some((binding) => binding.key === shortcut && applies(binding, focus)),
  );
  return (matching.find((command) => command.scope === "terminal") ?? matching[0])?.id;
}

/**
 * Touches portées par plusieurs commandes à la fois. Deux liaisons se gênent dès
 * qu'un même focus les rend actives ensemble — hors du terminal, toutes le sont.
 * Une commande du terminal ne gêne pas une commande générale sur la même touche :
 * elle la remplace dans le terminal, à dessein.
 */
export function conflicts(
  commands: readonly Bindable[],
  keymap: Keymap,
  overrides: Record<string, string | null>,
): { key: string; ids: string[] }[] {
  const byKey = new Map<string, { key: string; ids: string[] }>();
  for (const command of commands) {
    for (const binding of bindingsOf(command, keymap, overrides)) {
      const slot = `${command.scope ?? ""}:${binding.key}`;
      const entry = byKey.get(slot) ?? { key: binding.key, ids: [] };
      if (!entry.ids.includes(command.id)) entry.ids.push(command.id);
      byKey.set(slot, entry);
    }
  }
  return [...byKey.values()].filter((entry) => entry.ids.length > 1);
}

/** Ce que `shortcutOf` lit d'un évènement clavier. */
export interface KeyPress {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  getModifierState?: (key: string) => boolean;
}

const MODIFIERS = new Set(["Control", "Shift", "Alt", "Meta", "AltGraph"]);

/**
 * Nom d'une combinaison, ou rien pour une touche de modificateur seule.
 *
 * La lettre vient de `key`, pas de la position physique : sur un clavier AZERTY,
 * `Ctrl+Maj+A` est la touche marquée A. La rangée des chiffres fait exception
 * avec Ctrl ou Alt : son caractère change d'un clavier à l'autre (`&` ou `1`,
 * `1` ou `!` avec Maj), son chiffre non. Une combinaison avec AltGr ne donne rien,
 * c'est un caractère à taper.
 */
export function shortcutOf(event: KeyPress): string | undefined {
  if (MODIFIERS.has(event.key) || event.getModifierState?.("AltGraph")) return undefined;
  const digit = /^Digit(\d)$/.exec(event.code)?.[1];
  const key = digit && (event.ctrlKey || event.altKey) ? digit : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  return [event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift", key].filter(Boolean).join("+");
}

/**
 * Une combinaison qui ne porte ni Ctrl ni Alt se tape : elle ne peut pas servir
 * de raccourci. Les touches de fonction font exception, elles n'écrivent rien.
 */
export function isUsableShortcut(shortcut: string): boolean {
  return /^(Ctrl|Alt)\+/.test(shortcut) || /^(Shift\+)?F([1-9]|1[0-2])$/.test(shortcut);
}

/**
 * Où se trouve un élément du point de vue des raccourcis. La barre de recherche
 * d'un terminal en fait partie : son raccourci y ramène au champ.
 */
export function focusOf(target: EventTarget | null): Focus {
  if (!(target instanceof Element)) return "other";
  if (target.closest(".xterm, [data-terminal-find]")) return "terminal";
  if (target.closest(".monaco-editor")) return "editor";
  if (target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']")) return "input";
  return "other";
}
