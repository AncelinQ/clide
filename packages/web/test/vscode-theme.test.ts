import { describe, expect, it } from "vitest";

import { fromVscodeTheme, parseJsonc, restoreImportedTheme } from "../src/lib/vscode-theme";

const THEME = `{
  // Un thème sombre, commentaires et virgules finales compris.
  "name": "Nuit",
  "type": "dark",
  "colors": {
    "editor.background": "#1e1e2e",
    "sideBar.background": "#181825",
    "foreground": "#cdd6f4",
    "button.background": "#89b4fa",
    "terminal.ansiRed": "#f38ba8",
    "terminal.background": "#11111b",
    "editorLink.activeForeground": "rgb(1, 2, 3)", /* pas hexadécimal : ignoré */
  },
  "tokenColors": [
    { "scope": ["comment", "punctuation.definition.comment"], "settings": { "foreground": "#6c7086", "fontStyle": "italic" } },
    { "scope": "keyword.control, storage.type", "settings": { "foreground": "#cba6f7" } },
    { "name": "url", "scope": "markup.underline.link", "settings": { "foreground": "#89dceb" } },
    { "scope": "entity.name.type", "settings": { "foreground": "#f9e2af" } },
    { "scope": ["string meta.image.inline.markdown", "string.quoted.double"], "settings": { "foreground": "#ffffff" } },
    { "scope": "string", "settings": { "foreground": "#a6e3a1" } },
  ],
}`;

describe("parseJsonc", () => {
  it("lit commentaires et virgules finales, sans toucher aux chaînes", () => {
    expect(parseJsonc('{ "url": "https://a.b/c", /* x */ "n": [1, 2,], // fin\n }')).toEqual({ url: "https://a.b/c", n: [1, 2] });
  });
});

describe("fromVscodeTheme", () => {
  const theme = fromVscodeTheme(parseJsonc(THEME));

  it("traduit les couleurs en jetons de Clide et du terminal", () => {
    expect(theme.name).toBe("Nuit");
    expect(theme.mode).toBe("dark");
    expect(theme.vars).toMatchObject({
      "--background": "#181825",
      "--card": "#1e1e2e",
      "--foreground": "#cdd6f4",
      "--primary": "#89b4fa",
      "--term-bg": "#11111b",
      "--ansi-1": "#f38ba8",
    });
    expect(theme.editor.colors["editorLink.activeForeground"]).toBeUndefined();
  });

  it("donne à Monaco les portées d'origine et ses propres jetons", () => {
    expect(theme.editor.base).toBe("vs-dark");
    expect(theme.editor.rules).toContainEqual({ token: "comment", foreground: "6c7086", fontStyle: "italic" });
    expect(theme.editor.rules).toContainEqual({ token: "keyword.control", foreground: "cba6f7" });
    expect(theme.editor.rules).toContainEqual({ token: "keyword", foreground: "cba6f7" });
    // storage.type (const, function) est un mot-clé ; le jeton type vient des noms de type.
    expect(theme.editor.rules).toContainEqual({ token: "type", foreground: "f9e2af" });
    // Un sélecteur de descendance est écarté, et la portée la plus générale donne le jeton.
    expect(theme.editor.rules).toContainEqual({ token: "string", foreground: "a6e3a1" });
    expect(theme.editor.rules.some((rule) => rule.token.includes(" "))).toBe(false);
  });

  it("déduit le mode du fond sans type, et refuse ce qui n'est pas un thème", () => {
    expect(fromVscodeTheme({ colors: { "editor.background": "#fdf6e3" } }).mode).toBe("light");
    expect(() => fromVscodeTheme({ hello: 1 })).toThrow("thème VS Code");
    expect(() => fromVscodeTheme([1])).toThrow();
  });

  it("se relit depuis les préférences, en écartant ce qui n'est pas une couleur", () => {
    const saved = JSON.parse(JSON.stringify({ ...theme, vars: { ...theme.vars, "--x": "red", color: "#fff" } }));
    const restored = restoreImportedTheme(saved);
    expect(restored?.vars["--x"]).toBeUndefined();
    expect(restored?.vars["color"]).toBeUndefined();
    expect(restored?.vars["--primary"]).toBe("#89b4fa");
    expect(restoreImportedTheme({ name: "x" })).toBeNull();
  });
});
