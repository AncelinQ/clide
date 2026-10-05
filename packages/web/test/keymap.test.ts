import { describe, expect, it } from "vitest";

import { PRESETS, bindingsOf, commandFor, conflicts, shortcutOf, type Bindable, type KeyPress } from "../src/lib/keymap";

/** Une touche telle que le navigateur la décrit. */
function press(key: string, code: string, modifiers: { ctrl?: boolean; alt?: boolean; shift?: boolean; altGraph?: boolean } = {}): KeyPress {
  return {
    key,
    code,
    ctrlKey: modifiers.ctrl ?? false,
    altKey: modifiers.alt ?? false,
    shiftKey: modifiers.shift ?? false,
    getModifierState: (name) => name === "AltGraph" && (modifiers.altGraph ?? false),
  };
}

const COMMANDS: Bindable[] = [
  { id: "palette", shortcut: "Ctrl+Shift+P" },
  { id: "palette.files" },
  { id: "view.left", shortcut: "Ctrl+Shift+B" },
  { id: "tab.claude", shortcut: "Ctrl+Shift+A" },
  { id: "terminal.focus" },
];

describe("bindingsOf", () => {
  it("s'en tient aux défauts avec le jeu de Clide", () => {
    expect(bindingsOf(COMMANDS[2] as Bindable, "clide", {})).toEqual([{ key: "Ctrl+Shift+B" }]);
  });

  it("ajoute les touches du préréglage aux défauts", () => {
    expect(bindingsOf(COMMANDS[2] as Bindable, "vscode", {})).toEqual([
      { key: "Ctrl+Shift+B" },
      { key: "Ctrl+B", outside: true },
    ]);
  });

  it("laisse le choix de l'utilisateur remplacer défaut et préréglage", () => {
    expect(bindingsOf(COMMANDS[2] as Bindable, "vscode", { "view.left": "Ctrl+Shift+L" })).toEqual([
      { key: "Ctrl+Shift+L" },
    ]);
    expect(bindingsOf(COMMANDS[2] as Bindable, "vscode", { "view.left": null })).toEqual([]);
  });
});

describe("commandFor", () => {
  it("laisse au terminal une touche du préréglage qui lui sert aussi", () => {
    expect(commandFor("Ctrl+B", "terminal", COMMANDS, "vscode", {})).toBeUndefined();
    expect(commandFor("Ctrl+B", "input", COMMANDS, "vscode", {})).toBeUndefined();
    expect(commandFor("Ctrl+B", "other", COMMANDS, "vscode", {})).toBe("view.left");
  });

  it("donne ses touches d'IDE à l'éditeur de fichiers, qui n'est pas un simple champ", () => {
    expect(commandFor("Ctrl+B", "editor", COMMANDS, "vscode", {})).toBe("view.left");
  });

  it("prend un défaut partout, terminal compris", () => {
    expect(commandFor("Ctrl+Shift+B", "terminal", COMMANDS, "vscode", {})).toBe("view.left");
  });

  it("bascule sur les scripts par Alt+4 avec JetBrains, hors du terminal seulement", () => {
    const scripts: Bindable[] = [{ id: "tab.scripts", shortcut: "Ctrl+Shift+X" }];
    expect(commandFor("Alt+4", "other", scripts, "jetbrains", {})).toBe("tab.scripts");
    expect(commandFor("Alt+4", "terminal", scripts, "jetbrains", {})).toBeUndefined();
    expect(commandFor("Ctrl+Shift+X", "terminal", scripts, "jetbrains", {})).toBe("tab.scripts");
  });

  it("ignore une touche que le jeu choisi ne porte pas", () => {
    expect(commandFor("Ctrl+B", "other", COMMANDS, "clide", {})).toBeUndefined();
    expect(commandFor("Alt+1", "other", COMMANDS, "jetbrains", {})).toBe("view.left");
  });
});

describe("shortcutOf", () => {
  it("nomme une lettre par son caractère, la touche marquée A en AZERTY", () => {
    expect(shortcutOf(press("A", "KeyQ", { ctrl: true, shift: true }))).toBe("Ctrl+Shift+A");
  });

  it("nomme la rangée des chiffres par son chiffre, en AZERTY comme en QWERTY", () => {
    // AZERTY : Maj donne le chiffre, sans Maj la touche du 1 tape « & ».
    expect(shortcutOf(press("1", "Digit1", { ctrl: true, shift: true }))).toBe("Ctrl+Shift+1");
    expect(shortcutOf(press("&", "Digit1", { alt: true }))).toBe("Alt+1");
    expect(shortcutOf(press("à", "Digit0", { ctrl: true }))).toBe("Ctrl+0");
    // QWERTY : Maj+1 tape « ! ».
    expect(shortcutOf(press("!", "Digit1", { ctrl: true, shift: true }))).toBe("Ctrl+Shift+1");
  });

  it("laisse son caractère à un chiffre tapé sans Ctrl ni Alt, et au pavé numérique", () => {
    expect(shortcutOf(press("&", "Digit1"))).toBe("&");
    expect(shortcutOf(press("1", "Numpad1", { ctrl: true }))).toBe("Ctrl+1");
    expect(shortcutOf(press("End", "Numpad1", { ctrl: true }))).toBe("Ctrl+End");
  });

  it("ne nomme ni un modificateur seul ni une combinaison AltGr", () => {
    expect(shortcutOf(press("Shift", "ShiftLeft", { shift: true }))).toBeUndefined();
    expect(shortcutOf(press("#", "Digit3", { ctrl: true, alt: true, altGraph: true }))).toBeUndefined();
  });
});

describe("conflicts", () => {
  it("ne trouve rien dans les préréglages livrés, sur les défauts de Clide", () => {
    for (const keymap of ["clide", "vscode", "jetbrains"] as const) {
      expect(conflicts(COMMANDS, keymap, {})).toEqual([]);
    }
  });

  it("signale deux commandes sur la même touche", () => {
    expect(conflicts(COMMANDS, "vscode", { "tab.claude": "Ctrl+B" })).toEqual([
      { key: "Ctrl+B", ids: ["view.left", "tab.claude"] },
    ]);
  });

  it("n'attribue jamais à un préréglage une touche par défaut de Clide", () => {
    // Les défauts de state/commands.ts.
    const defaults = new Set([
      "Alt+PageDown", "Alt+PageUp", "Ctrl+Shift+1", "Ctrl+Shift+A", "Ctrl+Shift+B", "Ctrl+Shift+E", "Ctrl+Shift+H", "Ctrl+Shift+J",
      "Ctrl+Shift+O", "Ctrl+Shift+P", "Ctrl+Shift+PageDown", "Ctrl+Shift+PageUp", "Ctrl+Shift+S", "Ctrl+Shift+T",
      "Ctrl+Shift+U", "Ctrl+Shift+W", "Ctrl+Shift+X",
    ]);
    for (const preset of Object.values(PRESETS)) {
      for (const bindings of Object.values(preset)) {
        for (const binding of bindings) expect(defaults.has(binding.key)).toBe(false);
      }
    }
  });
});
