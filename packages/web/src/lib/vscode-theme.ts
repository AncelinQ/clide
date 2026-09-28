/**
 * Thèmes au format VS Code, chargés tels quels : le `.json` d'une extension de
 * thème (`colors`, `tokenColors`, `type`), traduit en jetons de couleur de Clide,
 * en couleurs du terminal et en thème Monaco.
 */

export interface EditorTheme {
  base: "vs" | "vs-dark";
  colors: Record<string, string>;
  rules: { token: string; foreground?: string; fontStyle?: string }[];
}

/** Un thème importé, tel qu'on le garde dans les préférences. */
export interface ImportedTheme {
  name: string;
  mode: "light" | "dark";
  /** Variables CSS posées sur la racine (`--background`, `--term-bg`, `--ansi-0`…). */
  vars: Record<string, string>;
  editor: EditorTheme;
}

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Une couleur en `#rrggbb` ou `#rrggbbaa` : Monaco et le calcul de clarté n'en lisent pas d'autre. */
function expand(hex: string): string {
  const digits = hex.slice(1);
  return digits.length <= 4 ? `#${[...digits].map((digit) => digit + digit).join("")}`.toLowerCase() : hex.toLowerCase();
}

/**
 * Lit du JSON avec commentaires et virgules finales, comme les fichiers de thème
 * de VS Code. Les chaînes sont respectées : un `//` dans une URL reste en place.
 */
export function parseJsonc(text: string): unknown {
  let out = "";
  let inString = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index] as string;
    const next = text[index + 1];
    if (inString) {
      out += char;
      if (char === "\\") {
        out += next ?? "";
        index++;
      } else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
    } else if (char === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") index++;
      out += "\n";
    } else if (char === "/" && next === "*") {
      index += 2;
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) index++;
      index++;
    } else out += char;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

/** Correspondance des jetons de Clide vers les couleurs de VS Code, la première présente l'emporte. */
const UI: Record<string, string[]> = {
  "--background": ["sideBar.background", "editor.background"],
  "--foreground": ["foreground", "editor.foreground", "sideBar.foreground"],
  "--card": ["editor.background", "sideBar.background"],
  "--card-foreground": ["editor.foreground", "foreground"],
  "--popover": ["editorWidget.background", "menu.background", "quickInput.background", "editor.background"],
  "--popover-foreground": ["editorWidget.foreground", "menu.foreground", "foreground", "editor.foreground"],
  "--primary": ["button.background", "focusBorder", "activityBarBadge.background"],
  "--primary-foreground": ["button.foreground", "activityBarBadge.foreground"],
  "--secondary": ["input.background", "dropdown.background", "sideBarSectionHeader.background"],
  "--secondary-foreground": ["input.foreground", "foreground", "editor.foreground"],
  "--muted": ["list.inactiveSelectionBackground", "input.background", "sideBarSectionHeader.background"],
  "--muted-foreground": ["descriptionForeground", "disabledForeground", "sideBarSectionHeader.foreground", "tab.inactiveForeground"],
  "--accent": ["list.hoverBackground", "list.inactiveSelectionBackground", "toolbar.hoverBackground"],
  "--accent-foreground": ["list.hoverForeground", "foreground", "editor.foreground"],
  "--destructive": ["errorForeground", "editorError.foreground"],
  "--border": ["panel.border", "sideBar.border", "editorGroup.border", "contrastBorder"],
  "--input": ["input.border", "dropdown.border", "panel.border", "contrastBorder"],
  "--ring": ["focusBorder", "button.background"],
  "--canvas": ["titleBar.activeBackground", "activityBar.background", "sideBar.background", "editor.background"],
  "--term-bg": ["terminal.background", "panel.background", "editor.background"],
  "--term-fg": ["terminal.foreground", "editor.foreground", "foreground"],
};

const ANSI = [
  "Black", "Red", "Green", "Yellow", "Blue", "Magenta", "Cyan", "White",
  "BrightBlack", "BrightRed", "BrightGreen", "BrightYellow", "BrightBlue", "BrightMagenta", "BrightCyan", "BrightWhite",
];

/**
 * Portées TextMate les plus courantes, vers les jetons de la coloration de Monaco,
 * qui n'en connaît pas d'autres. Une règle vaut pour tout jeton qui commence par
 * son nom : `keyword` colore `keyword.ts`.
 */
const SCOPES: [RegExp, string][] = [
  [/^comment/, "comment"],
  [/^string\.regexp/, "regexp"],
  [/^string/, "string"],
  [/^constant\.numeric/, "number"],
  [/^constant\.language|^constant\.character|^support\.constant/, "constant"],
  [/^keyword\.operator/, "operator"],
  [/^keyword|^storage/, "keyword"],
  [/^entity\.name\.type|^entity\.name\.class|^support\.type|^support\.class/, "type"],
  [/^entity\.name\.function|^support\.function|^meta\.function-call/, "function"],
  [/^entity\.name\.tag/, "tag"],
  [/^entity\.other\.attribute-name/, "attribute.name"],
  [/^variable\.parameter|^variable\.other|^variable$/, "variable"],
  [/^punctuation\.definition\.tag|^meta\.tag/, "delimiter"],
  [/^markup\.heading/, "keyword.md"],
  [/^markup\.underline\.link/, "string.link.md"],
];

function scopesOf(value: unknown): string[] {
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string").map((item) => item.trim());
  return [];
}

function rulesOf(tokenColors: unknown): EditorTheme["rules"] {
  if (!Array.isArray(tokenColors)) return [];
  const rules = new Map<string, EditorTheme["rules"][number]>();
  // Profondeur de la portée qui a donné chaque jeton Monaco : la plus générale l'emporte.
  const depth = new Map<string, number>();
  for (const entry of tokenColors) {
    if (typeof entry !== "object" || entry === null) continue;
    const settings = (entry as { settings?: { foreground?: unknown; fontStyle?: unknown } }).settings ?? {};
    const foreground = typeof settings.foreground === "string" && HEX.test(settings.foreground) ? expand(settings.foreground).slice(1) : undefined;
    const fontStyle = typeof settings.fontStyle === "string" ? settings.fontStyle : undefined;
    if (!foreground && !fontStyle) continue;
    for (const scope of scopesOf((entry as { scope?: unknown }).scope)) {
      // `string meta.image` est un sélecteur de descendance : Monaco ne le lit pas, et
      // il volerait le jeton `string` à la règle des chaînes.
      if (/\s/.test(scope)) continue;
      const rule = { ...(foreground ? { foreground } : {}), ...(fontStyle ? { fontStyle } : {}) };
      const token = SCOPES.find(([pattern]) => pattern.test(scope))?.[1];
      // Son jeton Monaco, pris à la portée la plus générale qui y mène.
      if (token) {
        const level = scope.split(".").length;
        if ((depth.get(token) ?? Infinity) > level) {
          depth.set(token, level);
          rules.set(token, { token, ...rule });
        }
      }
      // La portée d'origine, pour les langages qui la produisent ; la première l'emporte, comme dans VS Code.
      if (scope !== token && !rules.has(scope)) rules.set(scope, { token: scope, ...rule });
    }
  }
  return [...rules.values()];
}

/** Le mode d'un thème : son `type`, ou la clarté du fond de l'éditeur à défaut. */
function modeOf(type: unknown, background: string | undefined): "light" | "dark" {
  if (type === "light" || type === "hcLight") return "light";
  if (type === "dark" || type === "hc" || type === "hcDark") return "dark";
  if (!background) return "dark";
  const full = background.slice(1, 7);
  const [r, g, b] = [0, 2, 4].map((at) => Number.parseInt(full.slice(at, at + 2), 16) / 255) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5 ? "dark" : "light";
}

/**
 * Traduit un thème VS Code. Seules les couleurs hexadécimales passent ; un jeton
 * que le thème ne donne pas garde la valeur de Clide. Lève une erreur lisible
 * quand le fichier n'est pas un thème.
 */
export function fromVscodeTheme(json: unknown, fallbackName = "Thème VS Code"): ImportedTheme {
  if (typeof json !== "object" || json === null || Array.isArray(json)) throw new Error("ce fichier n'est pas un thème VS Code");
  const theme = json as { name?: unknown; type?: unknown; colors?: unknown; tokenColors?: unknown };
  const source = typeof theme.colors === "object" && theme.colors !== null ? (theme.colors as Record<string, unknown>) : {};
  const colors: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) if (typeof value === "string" && HEX.test(value)) colors[key] = expand(value);
  if (Object.keys(colors).length === 0 && !Array.isArray(theme.tokenColors)) throw new Error("ce fichier n'est pas un thème VS Code : ni colors ni tokenColors");

  const vars: Record<string, string> = {};
  for (const [token, keys] of Object.entries(UI)) {
    const found = keys.map((key) => colors[key]).find(Boolean);
    if (found) vars[token] = found;
  }
  if (vars["--canvas"]) vars["--canvas-end"] = vars["--canvas"];
  ANSI.forEach((name, index) => {
    const color = colors[`terminal.ansi${name}`];
    if (color) vars[`--ansi-${index}`] = color;
  });

  const mode = modeOf(theme.type, colors["editor.background"]);
  return {
    name: typeof theme.name === "string" && theme.name.trim() ? theme.name.trim().slice(0, 80) : fallbackName,
    mode,
    vars,
    editor: { base: mode === "dark" ? "vs-dark" : "vs", colors, rules: rulesOf(theme.tokenColors) },
  };
}

/** Relit un thème gardé dans les préférences ; une forme inattendue ne passe pas. */
export function restoreImportedTheme(value: unknown): ImportedTheme | null {
  if (typeof value !== "object" || value === null) return null;
  const theme = value as Partial<ImportedTheme>;
  if (typeof theme.name !== "string" || (theme.mode !== "light" && theme.mode !== "dark")) return null;
  if (typeof theme.vars !== "object" || theme.vars === null || typeof theme.editor !== "object" || theme.editor === null) return null;
  const vars = Object.fromEntries(
    Object.entries(theme.vars).filter(([key, color]) => key.startsWith("--") && typeof color === "string" && HEX.test(color)),
  ) as Record<string, string>;
  const editor = theme.editor as Partial<EditorTheme>;
  return {
    name: theme.name,
    mode: theme.mode,
    vars,
    editor: {
      base: editor.base === "vs" ? "vs" : "vs-dark",
      colors: typeof editor.colors === "object" && editor.colors !== null ? (editor.colors as Record<string, string>) : {},
      rules: Array.isArray(editor.rules) ? editor.rules : [],
    },
  };
}
