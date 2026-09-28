/** Un fichier modifié, tel que la vue Commit le range. */
export interface TreeChange {
  /** Chemin relatif au dépôt, séparé par `/`. */
  path: string;
}

/** Un dossier de l'arbre des changements, et ce qu'il contient. */
export interface ChangeDir<T extends TreeChange> {
  /** Chemin du dossier, sans barre finale ; `""` pour la racine. */
  path: string;
  /** Nom affiché : un ou plusieurs segments, quand des dossiers à enfant unique sont fusionnés. */
  name: string;
  dirs: ChangeDir<T>[];
  files: T[];
}

/**
 * Range des changements en dossiers, comme « Group by › Directory » de WebStorm :
 * un dossier qui ne contient qu'un dossier est fusionné avec lui (`src/components`),
 * les dossiers passent avant les fichiers, chacun dans l'ordre alphabétique.
 */
export function changeTree<T extends TreeChange>(changes: readonly T[]): ChangeDir<T> {
  const root: ChangeDir<T> = { path: "", name: "", dirs: [], files: [] };
  for (const change of changes) {
    const parts = change.path.split("/");
    let node = root;
    for (const part of parts.slice(0, -1)) {
      const path = node.path ? `${node.path}/${part}` : part;
      let child = node.dirs.find((dir) => dir.path === path);
      if (!child) {
        child = { path, name: part, dirs: [], files: [] };
        node.dirs.push(child);
      }
      node = child;
    }
    node.files.push(change);
  }
  const compact = (dir: ChangeDir<T>): ChangeDir<T> => {
    let node = dir;
    // La racine garde son nom vide : on ne fusionne que ses sous-dossiers.
    while (node.path !== "" && node.files.length === 0 && node.dirs.length === 1) {
      const only = node.dirs[0] as ChangeDir<T>;
      node = { ...only, name: `${node.name}/${only.name}` };
    }
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "fr", { numeric: true });
    return {
      ...node,
      dirs: node.dirs.map(compact).sort(byName),
      files: [...node.files].sort((a, b) => byName({ name: baseName(a.path) }, { name: baseName(b.path) })),
    };
  };
  return compact(root);
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Tous les fichiers d'un dossier, sous-dossiers compris. */
export function filesUnder<T extends TreeChange>(dir: ChangeDir<T>): T[] {
  return [...dir.files, ...dir.dirs.flatMap((child) => filesUnder(child))];
}
