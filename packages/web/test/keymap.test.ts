import { describe, expect, it } from "vitest";

import { PRESETS, bindingsOf, commandFor, conflicts, type Bindable } from "../src/lib/keymap";

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

  it("prend un défaut partout, terminal compris", () => {
    expect(commandFor("Ctrl+Shift+B", "terminal", COMMANDS, "vscode", {})).toBe("view.left");
  });

  it("ignore une touche que le jeu choisi ne porte pas", () => {
    expect(commandFor("Ctrl+B", "other", COMMANDS, "clide", {})).toBeUndefined();
    expect(commandFor("Alt+1", "other", COMMANDS, "jetbrains", {})).toBe("view.left");
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
      "Alt+PageDown", "Alt+PageUp", "Ctrl+Shift+A", "Ctrl+Shift+B", "Ctrl+Shift+E", "Ctrl+Shift+H", "Ctrl+Shift+J",
      "Ctrl+Shift+O", "Ctrl+Shift+P", "Ctrl+Shift+PageDown", "Ctrl+Shift+PageUp", "Ctrl+Shift+S", "Ctrl+Shift+T",
      "Ctrl+Shift+U", "Ctrl+Shift+W",
    ]);
    for (const preset of Object.values(PRESETS)) {
      for (const bindings of Object.values(preset)) {
        for (const binding of bindings) expect(defaults.has(binding.key)).toBe(false);
      }
    }
  });
});
