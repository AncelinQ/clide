/**
 * Habillage de l'interface : les couleurs qu'on choisit, hors terminal.
 *
 * Un habillage tient en deux couleurs, l'accent et la toile. La toile est le fond
 * de la fenêtre — derrière la barre de titre et entre les îlots — et peut être un
 * dégradé. Les îlots gardent la teinte neutre de leur mode, clair ou sombre, et le
 * terminal ses propres couleurs.
 */
export interface Look {
  /** Accent : boutons, onglet actif, liens, anneau de focus. Hexadécimal `#rrggbb`. */
  accent: string;
  /** Première couleur de la toile, ou la seule. Hexadécimal `#rrggbb`. */
  canvas: string;
  /** Seconde couleur de la toile, qui en fait un dégradé ; `null` pour une toile unie. */
  canvasEnd: string | null;
  /** Direction du dégradé, en degrés, dans le sens de `linear-gradient`. */
  angle: number;
}

/** Un habillage par mode : des îlots blancs ou sombres n'appellent pas la même toile. */
export interface LookPair {
  light: Look;
  dark: Look;
}

export interface LookPreset extends LookPair {
  id: string;
  /** Nom affiché, en français ; traduit par `t`. */
  name: string;
}

const ANGLE = 160;

const flat = (canvas: string, accent: string): Look => ({ accent, canvas, canvasEnd: null, angle: ANGLE });
const graded = (canvas: string, canvasEnd: string, accent: string): Look => ({ accent, canvas, canvasEnd, angle: ANGLE });

/**
 * Habillages proposés. Le premier est celui de l'application : ses couleurs sont
 * celles que la feuille de style donne au premier rendu.
 */
export const LOOK_PRESETS: LookPreset[] = [
  {
    id: "clide",
    name: "Clide",
    light: flat("#fafafa", "#2370db"),
    dark: flat("#0e0f11", "#3b93f7"),
  },
  {
    id: "burgundy",
    name: "Bourgogne",
    light: graded("#6e1a3a", "#3d0e22", "#8c1d3a"),
    dark: graded("#3a0d1c", "#1c060d", "#d9536f"),
  },
  {
    id: "emerald",
    name: "Vert émeraude",
    light: graded("#0f6b4a", "#08402c", "#0f8a5f"),
    dark: graded("#0a3d2b", "#041f15", "#2fbf8a"),
  },
  {
    id: "navy",
    name: "Bleu marine",
    light: graded("#1b2a5a", "#0d1533", "#2b4ea8"),
    dark: graded("#0f1a3d", "#060b1f", "#6a8cf0"),
  },
  {
    id: "lake-placid",
    name: "Bleu Lake Placid",
    light: graded("#3f79b8", "#2a5688", "#2d6cb0"),
    dark: graded("#234a78", "#122a48", "#5aa0e8"),
  },
  {
    id: "princess",
    name: "Vert princesse",
    light: graded("#cfe8d8", "#a9d6bd", "#1f7a4d"),
    dark: graded("#1d3b2c", "#0f2419", "#5fd39a"),
  },
  {
    id: "cream",
    name: "Crème",
    light: graded("#f4ecd8", "#e8dcbf", "#b06a1a"),
    dark: graded("#2a251c", "#1a1610", "#e6b25a"),
  },
  {
    id: "silver",
    name: "Argent",
    light: graded("#d9dbe0", "#b9bcc4", "#4b5563"),
    dark: graded("#2b2e35", "#1a1c21", "#a3a8b3"),
  },
  {
    id: "candy-cola",
    name: "Candy cola",
    light: graded("#5c2418", "#2f0f0a", "#a12626"),
    dark: graded("#361009", "#1a0704", "#e0574f"),
  },
];

export const DEFAULT_LOOK: LookPair = {
  light: (LOOK_PRESETS[0] as LookPreset).light,
  dark: (LOOK_PRESETS[0] as LookPreset).dark,
};

const HEX = /^#[0-9a-f]{6}$/i;

/** Luminance relative d'une couleur, entre 0 (noir) et 1 (blanc), au sens du WCAG. */
export function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  const linear = (channel: number): number => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(value >> 16) + 0.7152 * linear((value >> 8) & 255) + 0.0722 * linear(value & 255);
}

/**
 * Vrai si un texte clair se lit mieux sur cette couleur qu'un texte sombre.
 *
 * Le seuil est un peu au-dessus du point où les deux contrastes s'égalent : sur
 * un bleu ou un rouge moyen, le texte clair est celui qu'on attend.
 */
export function isDark(hex: string): boolean {
  return luminance(hex) < 0.25;
}

/** Polarité de la toile entière : celle de la moyenne de ses deux couleurs. */
export function canvasIsDark(look: Look): boolean {
  const end = look.canvasEnd ?? look.canvas;
  return (luminance(look.canvas) + luminance(end)) / 2 < 0.25;
}

/** Mélange de deux couleurs, canal par canal ; `weight` est la part de la seconde. */
export function mix(from: string, to: string, weight: number): string {
  const a = Number.parseInt(from.slice(1), 16);
  const b = Number.parseInt(to.slice(1), 16);
  const channel = (shift: number): string =>
    Math.round(((a >> shift) & 255) * (1 - weight) + ((b >> shift) & 255) * weight)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

/**
 * Seconde couleur proposée quand on passe une toile unie en dégradé : plus
 * sombre sur une toile sombre, tirée vers l'accent sur une toile claire, où un
 * assombrissement tournerait au gris.
 */
export function suggestedEnd(look: Look): string {
  return isDark(look.canvas) ? mix(look.canvas, "#000000", 0.45) : mix(look.canvas, look.accent, 0.3);
}

export function gradientOf(look: Look): string {
  return `linear-gradient(${look.angle}deg, ${look.canvas}, ${look.canvasEnd ?? look.canvas})`;
}

export function sameLook(a: Look, b: Look): boolean {
  return (
    a.accent === b.accent &&
    a.canvas === b.canvas &&
    a.canvasEnd === b.canvasEnd &&
    (a.canvasEnd === null || a.angle === b.angle)
  );
}

/** Le preset dont l'habillage est tiré tel quel, ou `undefined` s'il a été retouché. */
export function presetOf(pair: LookPair): LookPreset | undefined {
  return LOOK_PRESETS.find((preset) => sameLook(preset.light, pair.light) && sameLook(preset.dark, pair.dark));
}

function restoreOne(saved: unknown, fallback: Look): Look {
  const raw = (saved ?? {}) as Partial<Record<keyof Look, unknown>>;
  const hex = (value: unknown, otherwise: string): string =>
    typeof value === "string" && HEX.test(value) ? value.toLowerCase() : otherwise;
  const canvas = hex(raw.canvas, fallback.canvas);
  return {
    accent: hex(raw.accent, fallback.accent),
    canvas,
    canvasEnd: raw.canvasEnd === null ? null : raw.canvasEnd === undefined ? fallback.canvasEnd : hex(raw.canvasEnd, canvas),
    angle: typeof raw.angle === "number" && Number.isFinite(raw.angle) ? ((raw.angle % 360) + 360) % 360 : fallback.angle,
  };
}

/**
 * Relit un habillage mémorisé, champ par champ : une couleur qui n'est pas un
 * `#rrggbb` reprend celle du preset par défaut plutôt que d'invalider la toile.
 */
export function restoreLook(saved: unknown): LookPair {
  const raw = (saved ?? {}) as Partial<Record<keyof LookPair, unknown>>;
  return { light: restoreOne(raw.light, DEFAULT_LOOK.light), dark: restoreOne(raw.dark, DEFAULT_LOOK.dark) };
}
