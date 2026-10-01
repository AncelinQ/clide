/**
 * L'onglet Scripts : quels terminaux il range, dans quel ordre, et ce que le
 * projet en retient.
 *
 * Aucun drapeau ne dit que l'onglet Scripts est ouvert : il l'est quand le
 * terminal actif y est placé. Tout tient donc dans des règles sur les terminaux,
 * ici, en fonctions pures que le store applique et que les tests exercent.
 */

import type { TerminalInfo } from "@/lib/types";

/** Où vit un terminal : la barre d'onglets, ou l'onglet Scripts. */
export type Placement = "bar" | "scripts";

/** Nature d'un terminal de l'onglet Scripts, qui fait son groupe dans la liste. */
export type Nature = "server" | "test" | "build" | "check" | "install" | "other" | "shell";

/** Les groupes de la liste, dans l'ordre où elle les montre. */
export const NATURES: readonly Nature[] = ["server", "test", "build", "check", "install", "other", "shell"];

/** Ce que l'onglet Scripts d'un projet retient d'une session à l'autre. */
export interface ScriptsShelf {
  /** Script montré quand on entre dans l'onglet ; résolu à l'usage par `selectedScript`. */
  selected: string | null;
  /** Ce qu'on regardait dans la barre en entrant : le second clic y ramène, le bloc du bas suit `tab`. */
  back: { tab: string | null; file: string | null };
  /** Dernière commande que `runScript` a lancée dans chaque onglet de script : ce que relancer retape. */
  commands: Record<string, string>;
  /** Groupes repliés de la liste. */
  folded: Nature[];
}

export const EMPTY_SHELF: ScriptsShelf = { selected: null, back: { tab: null, file: null }, commands: {}, folded: [] };

type Tab = Pick<TerminalInfo, "id" | "kind" | "script" | "state" | "exited">;

/** Dossier et nom d'un script, depuis sa clé `dossier|nom` : un chemin Windows n'a jamais de `|`. */
export function splitScriptKey(key: string): { directory: string; name: string } {
  const at = key.indexOf("|");
  return at === -1 ? { directory: "", name: key } : { directory: key.slice(0, at), name: key.slice(at + 1) };
}

/** Un terminal qui porte une clé de script va dans l'onglet Scripts, les autres dans la barre. */
export function placementOf(tab: Pick<Tab, "script">): Placement {
  return tab.script ? "scripts" : "bar";
}

/** Terminaux d'un projet partagés entre la barre et l'onglet Scripts, dans l'ordre d'ouverture. */
export function splitTabs<T extends Tab>(own: readonly T[]): { bar: T[]; shelf: T[] } {
  const bar: T[] = [];
  const shelf: T[] = [];
  for (const tab of own) (placementOf(tab) === "scripts" ? shelf : bar).push(tab);
  return { bar, shelf };
}

/**
 * Segments reconnus de chaque nature, essayées dans cet ordre : le premier qui
 * reconnaît un segment du nom l'emporte. L'ordre tranche les noms mixtes :
 * `build-storybook` est un build, `test:watch` un test, `lint:ci` une vérification.
 */
const SEGMENTS: readonly [Nature, readonly string[]][] = [
  ["test", ["test", "tests", "e2e", "spec", "vitest", "jest", "pytest", "playwright"]],
  ["build", ["build", "compile", "bundle", "package", "dist"]],
  ["check", ["lint", "typecheck", "format", "fmt", "check", "clippy", "vet", "tsc"]],
  ["install", ["install", "ci", "bootstrap", "setup"]],
  ["server", ["dev", "start", "serve", "server", "preview", "storybook", "watch", "run", "runserver"]],
];

/**
 * Nature d'un terminal de l'onglet Scripts, lue au seul nom de son script.
 *
 * Le nom ne change pas pour un même onglet : une ligne ne change donc jamais de
 * groupe. Le corps du script n'est pas lu, la règle se devine depuis le nom
 * affiché ; un nom libre comme `web` tombe dans `other`. Sans clé, c'est un shell.
 */
export function natureOf(tab: Pick<Tab, "script">): Nature {
  if (!tab.script) return "shell";
  const segments = splitScriptKey(tab.script).name.toLowerCase().split(/[:\-_./\\\s]+/);
  for (const [nature, words] of SEGMENTS) {
    if (segments.some((segment) => words.includes(segment))) return nature;
  }
  return "other";
}

/** Groupes non vides de la liste, dans l'ordre de `NATURES` ; chacun garde l'ordre d'ouverture. */
export function shelfGroups<T extends Tab>(shelf: readonly T[]): { nature: Nature; tabs: T[] }[] {
  return NATURES.map((nature) => ({ nature, tabs: shelf.filter((tab) => natureOf(tab) === nature) })).filter(
    (group) => group.tabs.length > 0,
  );
}

/** Terminaux de l'onglet Scripts dans l'ordre de la liste : celui que suivent `↑` `↓` et la fermeture. */
export function shelfOrder<T extends Tab>(shelf: readonly T[]): T[] {
  return shelfGroups(shelf).flatMap((group) => group.tabs);
}

export type ShelfTone = "none" | "idle" | "running" | "failed";

/**
 * État d'un ensemble de terminaux de l'onglet Scripts, pour l'onglet épinglé ou
 * l'en-tête d'un groupe replié. Le compte et la couleur ne regardent que les
 * shells : une session Claude n'est pas un script en cours. Un échec l'emporte
 * sur ce qui tourne, qui l'emporte sur le reste.
 */
export function shelfSummary(
  tabs: readonly Tab[],
  attention: Readonly<Record<string, unknown>>,
): { running: number; tone: ShelfTone; attention: boolean } {
  const shells = tabs.filter((tab) => tab.kind === "shell" && !tab.exited);
  const running = shells.filter((tab) => tab.state === "running").length;
  const tone: ShelfTone =
    tabs.length === 0 ? "none" : shells.some((tab) => tab.state === "failed") ? "failed" : running > 0 ? "running" : "idle";
  return { running, tone, attention: tabs.some((tab) => attention[tab.id] !== undefined) };
}

/** Script montré en entrant : le retenu s'il est encore dans l'onglet, sinon le plus récemment ouvert. */
export function selectedScript(shelf: ScriptsShelf, opened: readonly string[]): string | null {
  if (shelf.selected && opened.includes(shelf.selected)) return shelf.selected;
  return opened.at(-1) ?? null;
}

/**
 * Où revenir en quittant l'onglet Scripts : l'onglet retenu s'il est encore dans
 * la barre, sinon le plus récent de la barre ; le fichier s'il est encore ouvert.
 */
export function backTarget(
  shelf: ScriptsShelf,
  bar: readonly string[],
  openFiles: readonly string[],
): { tab: string | null; file: string | null } {
  const tab = shelf.back.tab && bar.includes(shelf.back.tab) ? shelf.back.tab : (bar.at(-1) ?? null);
  const file = shelf.back.file && openFiles.includes(shelf.back.file) ? shelf.back.file : null;
  return { tab, file };
}

/**
 * Ce que l'onglet Scripts retient quand on passe de ce qu'on regardait à `target`.
 *
 * Regarder un script le retient comme `selected` et déplie son groupe. Y entrer
 * depuis la barre, ou depuis un fichier, retient ce qu'on quitte : le terminal
 * s'il était dans la barre — sinon l'ancien retour reste —, et le fichier.
 * Regarder un onglet de la barre ne change rien.
 */
export function lookAt(
  shelf: ScriptsShelf,
  from: { tab: string | null; placement: Placement | null; file: string | null },
  target: { id: string; placement: Placement; nature: Nature },
): ScriptsShelf {
  if (target.placement !== "scripts") return shelf;
  const entering = from.placement !== "scripts" || from.file !== null;
  return {
    ...shelf,
    selected: target.id,
    folded: shelf.folded.filter((nature) => nature !== target.nature),
    back: entering ? { tab: from.placement === "bar" ? from.tab : shelf.back.tab, file: from.file } : shelf.back,
  };
}

/**
 * Terminal à montrer quand le terminal affiché se ferme, et le fichier à rouvrir.
 *
 * Dans l'onglet Scripts : le voisin dans la liste, le suivant d'abord ; sans
 * voisin, le retour vers la barre (`back`, déjà résolu par `backTarget`). Dans la
 * barre : son premier onglet, jamais un script. `ids` contient encore le fermé.
 */
export function afterClose(
  closed: { id: string; placement: Placement },
  ids: { bar: readonly string[]; shelf: readonly string[] },
  back: { tab: string | null; file: string | null },
): { tab: string | null; file: string | null } {
  if (closed.placement === "bar") return { tab: ids.bar.find((id) => id !== closed.id) ?? null, file: null };
  const index = ids.shelf.indexOf(closed.id);
  const rest = ids.shelf.filter((id) => id !== closed.id);
  const neighbour = index === -1 ? rest.at(-1) : (rest[index] ?? rest[index - 1]);
  if (neighbour) return { tab: neighbour, file: null };
  return { tab: back.tab === closed.id ? null : back.tab, file: back.file };
}

/** Arrêts du parcours des onglets au clavier : l'onglet Scripts d'abord, pour un seul arrêt, puis la barre. */
export function tabStops(bar: readonly string[], opened: readonly string[], shelf: ScriptsShelf): string[] {
  const script = selectedScript(shelf, opened);
  return script ? [script, ...bar] : [...bar];
}
