import { cp, lstat, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";

/** Que faire quand la cible porte déjà ce nom. */
export type OnConflict = "ask" | "keepBoth" | "replace";

/** Ce qu'une opération a fait d'un élément. */
export interface Outcome {
  source: string;
  target: string;
  /** `skipped` : `ask` a trouvé un nom pris, et rien n'a été fait. */
  status: "done" | "skipped";
  /** La cible portait déjà ce nom. */
  conflict?: boolean;
}

/**
 * Nom libre à côté de `name`, comme l'Explorateur de Windows : `rapport (2).md`,
 * puis `(3)`… L'extension reste en place ; un nom qui porte déjà `(n)` repart de
 * sa base plutôt que d'empiler `(2) (2)`.
 */
export function keepBothName(name: string, taken: (candidate: string) => boolean): string {
  if (!taken(name)) return name;
  const extension = name.startsWith(".") && name.indexOf(".", 1) === -1 ? "" : extname(name);
  const stem = name.slice(0, name.length - extension.length).replace(/ \(\d+\)$/, "");
  for (let index = 2; ; index++) {
    const candidate = `${stem} (${index})${extension}`;
    if (!taken(candidate)) return candidate;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

/** Vrai si `child` est `parent` ou se trouve dessous. */
function within(parent: string, child: string): boolean {
  const path = relative(resolve(parent), resolve(child));
  return path === "" || (!path.startsWith("..") && !path.startsWith(sep) && !/^[a-zA-Z]:/.test(path));
}

/** Nom qu'un caractère interdit ou un chemin rendrait dangereux : refusé plutôt qu'interprété. */
export function checkName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed === "." || trimmed === "..") throw new Error("nom vide");
  if (/[\\/:*?"<>|]/.test(trimmed)) throw new Error(`caractère interdit dans « ${trimmed} »`);
  return trimmed;
}

/** Crée un fichier vide ou un dossier ; refuse un nom déjà pris. */
export async function createEntry(parent: string, name: string, kind: "file" | "dir"): Promise<string> {
  const target = join(parent, checkName(name));
  if (await exists(target)) throw new Error(`« ${basename(target)} » existe déjà`);
  if (kind === "dir") await mkdir(target);
  else await writeFile(target, "", { flag: "wx" });
  return target;
}

/** Renomme dans le même dossier ; refuse un nom déjà pris, sauf un simple changement de casse. */
export async function renameEntry(path: string, name: string): Promise<string> {
  const target = join(dirname(path), checkName(name));
  if (target === path) return path;
  const caseOnly = target.toLowerCase() === path.toLowerCase();
  if (!caseOnly && (await exists(target))) throw new Error(`« ${basename(target)} » existe déjà`);
  await rename(path, target);
  return target;
}

export interface TransferOptions {
  onConflict: OnConflict;
  /** Met un élément à la corbeille : un `replace` y envoie la cible, jamais ne l'écrase. */
  trash: (paths: string[]) => Promise<void>;
}

/**
 * Copie ou déplace des éléments dans `targetDir`.
 *
 * Avec `ask`, rien n'est fait tant qu'un nom est pris : les éléments en cause
 * reviennent `skipped`, pour que l'interface demande. `keepBoth` nomme la copie
 * `nom (2)`. `replace` envoie d'abord la cible à la corbeille. Un dossier ne se
 * copie ni ne se déplace dans lui-même.
 */
export async function transfer(
  mode: "copy" | "move",
  sources: string[],
  targetDir: string,
  options: TransferOptions,
): Promise<Outcome[]> {
  for (const source of sources) {
    if (within(source, targetDir)) throw new Error(`« ${basename(source)} » ne peut aller dans lui-même`);
  }
  const planned = await Promise.all(
    sources.map(async (source) => ({ source, target: join(targetDir, basename(source)) })),
  );
  const clashing = new Set<string>();
  for (const item of planned) {
    // Déplacer un élément là où il est déjà ne fait rien, et n'est pas un conflit.
    if (mode === "move" && resolve(item.source) === resolve(item.target)) continue;
    if (await exists(item.target)) clashing.add(item.source);
  }
  if (options.onConflict === "ask" && clashing.size > 0) {
    return planned.map((item) => ({ ...item, status: "skipped", conflict: clashing.has(item.source) }));
  }

  const outcomes: Outcome[] = [];
  // Noms pris dans la cible, complétés au fil des copies : deux sources de même
  // nom ne se disputent pas le même `(2)`.
  const names = new Set((await readdir(targetDir)).map((name) => name.toLowerCase()));
  for (const item of planned) {
    let target = item.target;
    if (mode === "move" && resolve(item.source) === resolve(target)) {
      outcomes.push({ source: item.source, target, status: "done" });
      continue;
    }
    if (clashing.has(item.source)) {
      if (options.onConflict === "replace") await options.trash([target]);
      else target = join(targetDir, keepBothName(basename(target), (candidate) => names.has(candidate.toLowerCase())));
    }
    if (mode === "copy") {
      await cp(item.source, target, { recursive: true, errorOnExist: true, force: false });
    } else {
      try {
        await rename(item.source, target);
      } catch (error) {
        // D'un disque à l'autre, `rename` échoue : on copie, puis on retire l'original.
        if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
        await cp(item.source, target, { recursive: true, errorOnExist: true, force: false });
        await rm(item.source, { recursive: true, force: true });
      }
    }
    names.add(basename(target).toLowerCase());
    outcomes.push({ source: item.source, target, status: "done" });
  }
  return outcomes;
}
