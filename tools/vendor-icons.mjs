#!/usr/bin/env node
/**
 * Recopie les icônes de fichiers de Catppuccin (catppuccin/vscode-icons, MIT)
 * dans le client : un sprite SVG et la table qui associe un nom ou une extension
 * à une icône.
 *
 * On prend le jeu `css-variables` : ses couleurs sont des variables
 * `--vscode-ctp-*`, que la page définit pour le thème clair (Latte) et sombre
 * (Mocha). Un seul jeu sert donc aux deux thèmes. Les icônes sont réunies en
 * `<symbol>` dans un sprite, utilisé par `<use>` : une image chargée par `<img>`
 * ne verrait pas les variables de la page, un `<use>` en hérite.
 *
 * Usage : node --import tsx tools/vendor-icons.mjs [version]
 */
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const VERSION = process.argv[2] ?? "v1.26.0";
const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, "..", "packages", "web");
const SPRITE = join(WEB, "public", "catppuccin", "icons.svg");
const LICENSE = join(WEB, "public", "catppuccin", "LICENSE");
const MAP = join(WEB, "src", "assets", "catppuccin-map.json");

const work = await mkdtemp(join(tmpdir(), "clide-icons-"));
try {
  const response = await fetch(`https://codeload.github.com/catppuccin/vscode-icons/tar.gz/refs/tags/${VERSION}`);
  if (!response.ok) throw new Error(`téléchargement refusé : HTTP ${response.status}`);
  const archive = join(work, "icons.tar.gz");
  await writeFile(archive, Buffer.from(await response.arrayBuffer()));
  execFileSync("tar", ["-xzf", "icons.tar.gz"], { cwd: work });
  const [folder] = (await readdir(work)).filter((name) => name.startsWith("vscode-icons"));
  if (!folder) throw new Error("archive sans dossier vscode-icons");
  const source = join(work, folder);

  const { fileExtensions, fileNames } = await import(pathToFileURL(join(source, "src", "defaults", "fileIcons.ts")).href);
  const { folderNames } = await import(pathToFileURL(join(source, "src", "defaults", "folderIcons.ts")).href);

  const iconsDir = join(source, "icons", "css-variables");
  const files = (await readdir(iconsDir)).filter((name) => name.endsWith(".svg")).sort();
  const symbols = [];
  for (const file of files) {
    const svg = await readFile(join(iconsDir, file), "utf8");
    const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1] ?? "0 0 16 16";
    const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").trim();
    symbols.push(`<symbol id="${file.slice(0, -4)}" viewBox="${viewBox}">${inner}</symbol>`);
  }

  const available = new Set(files.map((file) => file.slice(0, -4)));
  const keep = (table) =>
    Object.fromEntries(
      Object.entries(table)
        .filter(([, icon]) => available.has(icon))
        .map(([key, icon]) => [key.toLowerCase(), icon]),
    );

  await mkdir(dirname(SPRITE), { recursive: true });
  await mkdir(dirname(MAP), { recursive: true });
  await writeFile(
    SPRITE,
    `<svg xmlns="http://www.w3.org/2000/svg">\n<!-- catppuccin/vscode-icons ${VERSION}, MIT -->\n${symbols.join("\n")}\n</svg>\n`,
  );
  await writeFile(LICENSE, await readFile(join(source, "LICENSE"), "utf8"));
  await writeFile(
    MAP,
    `${JSON.stringify(
      {
        version: VERSION,
        fileExtensions: keep(fileExtensions),
        fileNames: keep(fileNames),
        folderNames: keep(folderNames),
      },
      null,
      1,
    )}\n`,
  );
  console.log(`${symbols.length} icônes, ${VERSION}`);
} finally {
  await rm(work, { recursive: true, force: true });
}
