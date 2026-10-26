/** Affichage et filtre du Mémo d'un projet. */

/** Sans accents ni casse : « Idées » se trouve en tapant « idee ». */
function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Le texte contient chaque mot du filtre, sans égard aux accents ni à la casse. */
export function matchesFilter(text: string, filter: string): boolean {
  const folded = fold(text);
  return fold(filter)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => folded.includes(word));
}

/** L'adresse telle qu'elle s'affiche sous le nom du lien : sans schéma ni barre finale. */
export function shortUrl(url: string): string {
  return url.replace(/^(https?:\/\/|mailto:)/i, "").replace(/\/$/, "");
}

/** Un chemin tel que le projet le nomme : relatif sous lui, entier ailleurs. */
export function underRoot(path: string, root: string): string {
  const prefix = root.replace(/[\\/]+$/, "");
  const rest = path.slice(prefix.length);
  return path.toLowerCase().startsWith(prefix.toLowerCase()) && /^[\\/]/.test(rest) ? rest.slice(1) : path;
}

/** Le nom d'un fichier, sans son dossier. */
export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
