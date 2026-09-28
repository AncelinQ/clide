import map from "@/assets/catppuccin-map.json";

/** Tables de Catppuccin : clés en minuscules, valeurs au nom de l'icône du sprite. */
export interface IconMap {
  fileExtensions: Record<string, string>;
  fileNames: Record<string, string>;
  folderNames: Record<string, string>;
}

const CATPPUCCIN: IconMap = map;

/**
 * Icône d'un fichier ou d'un dossier, comme la choisit VS Code avec ce thème.
 *
 * Un nom connu l'emporte (`package.json`, `src`) ; sinon, pour un fichier, les
 * extensions composées de la plus longue à la plus courte (`a.d.ts` essaie
 * `d.ts`, puis `ts`) ; à défaut, l'icône générique. Un dossier ouvert prend la
 * variante `_open` de la sienne.
 */
export function iconFor(name: string, directory: boolean, open = false, table: IconMap = CATPPUCCIN): string {
  const lower = name.toLowerCase();
  if (directory) {
    const icon = table.folderNames[lower] ?? "_folder";
    return open ? `${icon}_open` : icon;
  }
  const named = table.fileNames[lower];
  if (named) return named;
  const parts = lower.split(".");
  for (let index = 1; index < parts.length; index++) {
    const icon = table.fileExtensions[parts.slice(index).join(".")];
    if (icon) return icon;
  }
  return "_file";
}
