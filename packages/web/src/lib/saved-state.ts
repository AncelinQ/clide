/**
 * Forme de l'état mémorisé de l'interface, et lecture des formes antérieures.
 *
 * Fonctions pures : le store lit et écrit par elles, les tests les exercent sur
 * de vrais états sauvegardés. Une valeur illisible est remplacée par sa valeur
 * par défaut, jamais propagée : un état corrompu rouvrirait sinon l'application
 * dans un état que rien ne sait afficher.
 */

export const SAVED_VERSION = 2;

/** Ce qu'un projet ouvert retient d'une session à l'autre. */
export interface SavedProject {
  root: string;
  /** Dossier parcouru dans l'explorateur, relatif à la racine. */
  browsePath: string;
  /** Mode du bloc de la colonne gauche. */
  leftMode: string;
  /** Mode du bloc session, sous le terminal. */
  bottomMode: string;
  /** Dernier onglet regardé, par identifiant de terminal ; les terminaux survivent au rechargement de la page. */
  activeTab: string | null;
  /** Fichiers ouverts dans l'éditeur, par chemin absolu, dans l'ordre des onglets. */
  openFiles: string[];
  /** Fichier montré au centre ; `null` quand c'est un terminal. */
  activeFile: string | null;
  /**
   * Ordre des onglets du centre, terminaux et fichiers mêlés, tel qu'on l'a
   * rangé. Vide, ou pour un onglet qui n'y figure pas : l'ordre d'ouverture.
   */
  tabOrder: string[];
}

export interface SavedLayout {
  /** Colonnes en pixels ; îlot du bas en part de la hauteur du centre. */
  widths: { left: number; right: number; bottom: number };
  /** Hauteur du bas de chaque pile de vues, en pixels, par identifiant de pile. */
  stacks: Record<string, number>;
  showLeft: boolean;
  showRight: boolean;
  sessionCollapsed: boolean;
  globalTab: string;
}

export interface SavedPrefs {
  theme: "auto" | "light" | "dark";
  /** Couleurs de l'interface, relues par `restoreLook` qui en connaît la forme. */
  look: unknown;
  /** Thème VS Code importé, relu par `restoreImportedTheme` ; il l'emporte sur l'habillage et le mode. */
  vscodeTheme: unknown;
  terminalFont: { family: string; size: number };
  /** Police de l'interface, et son échelle en pour cent : à part de celles du terminal. */
  uiFont: { family: string; scale: number };
  shortcuts: Record<string, string | null>;
  language: "auto" | "fr" | "en";
  tabLayout: "row" | "column";
  visibleTabs: string[] | null;
  hiddenModes: Record<string, string[]>;
  newestFirst: Record<string, boolean>;
  showHidden: boolean;
  /** Jeu de raccourcis ajouté aux défauts de Clide. */
  keymap: "clide" | "vscode" | "jetbrains";
  /** Les coûts des sessions s'affichent dans l'historique, l'activité et l'en-tête du terminal. */
  showCosts: boolean;
  /** Modules coupés dans les Réglages, par identifiant. */
  disabledModules: string[];
  /** Dossier où s'ouvre le sélecteur quand son champ est vide ; vide, Windows choisit. */
  projectsFolder: string;
  /** L'application de bureau cherche seule ses nouvelles versions. */
  autoUpdate: boolean;
}

export interface SavedState {
  version: typeof SAVED_VERSION;
  projects: SavedProject[];
  active: string | null;
  layout: SavedLayout;
  prefs: SavedPrefs;
}

export const DEFAULT_LAYOUT: SavedLayout = {
  widths: { left: 290, right: 340, bottom: 0.38 },
  stacks: {},
  showLeft: true,
  showRight: true,
  sessionCollapsed: false,
  globalTab: "history",
};

export const DEFAULT_PREFS: SavedPrefs = {
  theme: "auto",
  look: undefined,
  vscodeTheme: null,
  terminalFont: { family: "", size: 13 },
  uiFont: { family: "", scale: 100 },
  shortcuts: {},
  language: "auto",
  tabLayout: "column",
  visibleTabs: null,
  hiddenModes: {},
  newestFirst: {},
  showHidden: false,
  keymap: "vscode",
  showCosts: true,
  disabledModules: [],
  projectsFolder: "",
  autoUpdate: true,
};

/** Échelles proposées pour l'interface, en pour cent. */
export const UI_SCALES = [85, 90, 100, 110, 125, 150] as const;

export const DEFAULT_PROJECT: Omit<SavedProject, "root"> = {
  browsePath: "",
  leftMode: "explorer",
  bottomMode: "files",
  activeTab: null,
  openFiles: [],
  activeFile: null,
  tabOrder: [],
};

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, fallback: string): string => (typeof value === "string" ? value : fallback);
const flag = (value: unknown, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback);
const number = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

function recordOf<T>(value: unknown, keep: (item: unknown) => item is T): Record<string, T> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, T] => keep(entry[1])));
}

/** Racine sans séparateur final : la forme sous laquelle un projet est comparé. */
export function trimRoot(root: string): string {
  return root.replace(/[\\/]+$/, "");
}

/**
 * Activité de la colonne gauche. Les dossiers liés, un mode à part avant les
 * barres d'activité, vivent désormais sous l'explorateur.
 */
function leftActivity(value: unknown): string {
  if (value === "links") return "explorer";
  return text(value, DEFAULT_PROJECT.leftMode);
}

/** Mode du bloc session. Le commit, un temps en bas, vit dans la colonne du projet. */
function bottomActivity(value: unknown): string {
  if (value === "commit") return DEFAULT_PROJECT.bottomMode;
  return text(value, DEFAULT_PROJECT.bottomMode);
}

function project(value: unknown, fallbackTab?: string): SavedProject | undefined {
  if (!isRecord(value) || typeof value["root"] !== "string" || !trimRoot(value["root"])) return undefined;
  const tab = value["activeTab"] ?? fallbackTab;
  const openFiles = [...new Set(strings(value["openFiles"]))];
  const activeFile = typeof value["activeFile"] === "string" && openFiles.includes(value["activeFile"]) ? value["activeFile"] : null;
  return {
    root: trimRoot(value["root"]),
    browsePath: text(value["browsePath"], DEFAULT_PROJECT.browsePath),
    leftMode: leftActivity(value["leftMode"]),
    bottomMode: bottomActivity(value["bottomMode"]),
    activeTab: typeof tab === "string" ? tab : null,
    openFiles,
    activeFile,
    tabOrder: [...new Set(strings(value["tabOrder"]))],
  };
}

/**
 * Onglet du panneau global sous son nom courant. Les réglages de Claude Code ont
 * rejoint la fenêtre Réglages ; l'usage et les coûts, l'onglet Consommation.
 */
function globalTabId(id: string): string {
  if (id === "settings") return DEFAULT_LAYOUT.globalTab;
  if (id === "usage" || id === "costs") return "consumption";
  return id;
}

function layout(value: unknown): SavedLayout {
  const source = isRecord(value) ? value : {};
  const widths = isRecord(source["widths"]) ? source["widths"] : {};
  return {
    widths: {
      left: number(widths["left"], DEFAULT_LAYOUT.widths.left),
      right: number(widths["right"], DEFAULT_LAYOUT.widths.right),
      bottom: number(widths["bottom"], DEFAULT_LAYOUT.widths.bottom),
    },
    stacks: recordOf(source["stacks"], (item): item is number => typeof item === "number" && Number.isFinite(item)),
    showLeft: flag(source["showLeft"], DEFAULT_LAYOUT.showLeft),
    showRight: flag(source["showRight"], DEFAULT_LAYOUT.showRight),
    sessionCollapsed: flag(source["sessionCollapsed"], DEFAULT_LAYOUT.sessionCollapsed),
    globalTab: globalTabId(text(source["globalTab"], DEFAULT_LAYOUT.globalTab)),
  };
}

function prefs(value: unknown): SavedPrefs {
  const source = isRecord(value) ? value : {};
  const font = isRecord(source["terminalFont"]) ? source["terminalFont"] : {};
  const ui = isRecord(source["uiFont"]) ? source["uiFont"] : {};
  const scale = number(ui["scale"], DEFAULT_PREFS.uiFont.scale);
  const visible = source["visibleTabs"];
  return {
    theme: oneOf(source["theme"], ["auto", "light", "dark"], DEFAULT_PREFS.theme),
    look: source["look"],
    vscodeTheme: source["vscodeTheme"] ?? null,
    terminalFont: {
      family: text(font["family"], DEFAULT_PREFS.terminalFont.family),
      size: number(font["size"], DEFAULT_PREFS.terminalFont.size),
    },
    uiFont: {
      family: text(ui["family"], DEFAULT_PREFS.uiFont.family),
      scale: (UI_SCALES as readonly number[]).includes(scale) ? scale : DEFAULT_PREFS.uiFont.scale,
    },
    shortcuts: recordOf(source["shortcuts"], (item): item is string | null => item === null || typeof item === "string"),
    language: oneOf(source["language"], ["auto", "fr", "en"], DEFAULT_PREFS.language),
    tabLayout: oneOf(source["tabLayout"], ["row", "column"], DEFAULT_PREFS.tabLayout),
    visibleTabs: Array.isArray(visible) ? [...new Set(strings(visible).map(globalTabId))] : null,
    hiddenModes: Object.fromEntries(
      Object.entries(isRecord(source["hiddenModes"]) ? source["hiddenModes"] : {}).map(([key, list]) => [key, strings(list)]),
    ),
    newestFirst: recordOf(source["newestFirst"], (item): item is boolean => typeof item === "boolean"),
    showHidden: flag(source["showHidden"], DEFAULT_PREFS.showHidden),
    keymap: oneOf(source["keymap"], ["clide", "vscode", "jetbrains"], DEFAULT_PREFS.keymap),
    showCosts: flag(source["showCosts"], DEFAULT_PREFS.showCosts),
    disabledModules: strings(source["disabledModules"]),
    projectsFolder: text(source["projectsFolder"], DEFAULT_PREFS.projectsFolder),
    autoUpdate: flag(source["autoUpdate"], DEFAULT_PREFS.autoUpdate),
  };
}

/** Garde la première occurrence de chaque racine, casse et séparateur final ignorés. */
function unique(projects: SavedProject[]): SavedProject[] {
  const seen = new Set<string>();
  return projects.filter((item) => {
    const key = item.root.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Lit un état sauvegardé, de n'importe quelle version connue, dans la forme
 * courante.
 *
 * La version 1 était à plat : `roots` pour les projets, les préférences et les
 * largeurs à la racine, `lastTab` par racine. Elle ne retenait ni les modes des
 * projets ni la disposition des blocs, qui prennent leur valeur par défaut.
 */
export function migrate(raw: unknown): SavedState {
  const source = isRecord(raw) ? raw : {};
  let projects: SavedProject[];
  let layoutSource: unknown;
  let prefsSource: unknown;

  if (source["version"] === SAVED_VERSION) {
    projects = (Array.isArray(source["projects"]) ? source["projects"] : [])
      .map((item) => project(item))
      .filter((item): item is SavedProject => item !== undefined);
    layoutSource = source["layout"];
    prefsSource = source["prefs"];
  } else {
    const lastTab = recordOf(source["lastTab"], (item): item is string => typeof item === "string");
    projects = strings(source["roots"])
      .map((root) => project({ root }, lastTab[root] ?? lastTab[trimRoot(root)]))
      .filter((item): item is SavedProject => item !== undefined);
    layoutSource = { widths: source["widths"] };
    prefsSource = source;
  }

  projects = unique(projects);
  const active = typeof source["active"] === "string" ? trimRoot(source["active"]) : undefined;
  return {
    version: SAVED_VERSION,
    projects,
    active: projects.find((item) => item.root.toLowerCase() === active?.toLowerCase())?.root ?? projects[0]?.root ?? null,
    layout: layout(layoutSource),
    prefs: prefs(prefsSource),
  };
}
