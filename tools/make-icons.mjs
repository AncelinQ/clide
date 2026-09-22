#!/usr/bin/env node
/**
 * Génère `packages/web/icons.js` depuis les SVG de `lucide-static`.
 *
 * Les tracés sont recopiés plutôt que chargés à l'exécution : le client n'a pas
 * d'outil de construction, et embarquer les 2112 icônes du paquet pour en
 * utiliser trente serait absurde. Le générateur garde le lien avec la source —
 * relancer la commande suffit à suivre une montée de version.
 *
 * Usage : node tools/make-icons.mjs
 */
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const LUCIDE = join(dirname(require.resolve("lucide-static/package.json")), "icons");
const OUT = join(HERE, "..", "packages", "web", "icons.js");

/** Nom interne → nom Lucide. La colonne de gauche est ce que l'interface demande. */
const WANTED = {
  panelLeft: "panel-left",
  panelRight: "panel-right",
  plus: "plus",
  close: "x",
  chevronRight: "chevron-right",
  chevronDown: "chevron-down",
  chevronUp: "chevron-up",
  arrowUp: "arrow-up",
  refresh: "refresh-cw",
  folder: "folder",
  file: "file",
  project: "square-dashed",
  link: "link-2",
  package: "package",
  sparkle: "sparkles",
  plug: "plug",
  branch: "git-branch",
  clipboard: "clipboard-list",
  activity: "activity",
  fileDiff: "file-diff",
  cpu: "cpu",
  clock: "history",
  gear: "settings",
  bell: "bell",
  terminal: "terminal",
  sun: "sun",
  moon: "moon",
  contrast: "contrast",
  play: "play",
  trash: "trash-2",
  edit: "pencil",
  info: "info",
  search: "search",
  stop: "square",
};

/** Retient le contenu du `<svg>`, seul morceau qui décrit le dessin. */
function extractBody(svg) {
  const open = svg.indexOf(">", svg.indexOf("<svg"));
  const close = svg.lastIndexOf("</svg>");
  return svg
    .slice(open + 1, close)
    .replace(/\s*\n\s*/g, "")
    .trim();
}

const entries = [];
for (const [name, lucide] of Object.entries(WANTED)) {
  const svg = await readFile(join(LUCIDE, `${lucide}.svg`), "utf8");
  entries.push([name, lucide, extractBody(svg)]);
}

const version = require("lucide-static/package.json").version;

const file = `// Jeu d'icônes de l'interface. FICHIER GÉNÉRÉ — voir tools/make-icons.mjs.
//
// Tracés de Lucide ${version} (licence ISC, https://lucide.dev), recopiés plutôt
// que chargés à l'exécution : le client n'a pas d'outil de construction, et le
// paquet compte 2112 icônes pour la trentaine utilisée ici.
//
// Des emoji auraient été plus courts à écrire, mais Windows les rend en Segoe UI
// Emoji : colorés, de tailles inégales et indifférents au thème. Ces tracés
// héritent de \`currentColor\` et suivent donc le texte, l'accent et le thème.

const BODIES = {
${entries.map(([name, lucide, body]) => `  // lucide/${lucide}\n  ${name}: ${JSON.stringify(body)},`).join("\n")}
};

/**
 * Rend une icône.
 *
 * L'épaisseur du trait est fixée en unités de la grille de 24 : elle grossit
 * donc avec la taille demandée, ce qui garde la même densité visuelle qu'un
 * texte de même corps.
 */
export function icon(name, size = 16) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("icon");
  svg.innerHTML = BODIES[name] ?? BODIES.file;
  return svg;
}

/** Icône pleine, pour une marque d'état plutôt qu'une commande. */
export function solidIcon(name, size = 12) {
  const svg = icon(name, size);
  svg.setAttribute("fill", "currentColor");
  return svg;
}

export const ICON_NAMES = Object.keys(BODIES);
`;

await writeFile(OUT, file, "utf8");
console.log(`${entries.length} icônes Lucide ${version} écrites dans packages/web/icons.js`);
