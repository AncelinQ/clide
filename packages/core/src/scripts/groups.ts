import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

/** Un script d'un groupe : où le lancer et quoi taper. */
export interface GroupScript {
  /** Dossier, relatif au projet (`""` pour sa racine, `../api` pour un dossier lié à côté). */
  directory: string;
  name: string;
  run: string;
}

/** Des scripts qu'on lance ensemble : « Tout démarrer » = l'API, le front et le design system. */
export interface ScriptGroup {
  id: string;
  label: string;
  scripts: GroupScript[];
}

/** Fichier des groupes d'un projet : versionnable, comme ses prompts. */
export function groupsFile(root: string): string {
  return join(root, ".claude", "clide-scripts.json");
}

function valid(value: unknown): value is ScriptGroup {
  if (typeof value !== "object" || value === null) return false;
  const group = value as Record<string, unknown>;
  return (
    typeof group["id"] === "string" &&
    typeof group["label"] === "string" &&
    Array.isArray(group["scripts"]) &&
    group["scripts"].every(
      (script: unknown) =>
        typeof script === "object" &&
        script !== null &&
        typeof (script as GroupScript).directory === "string" &&
        typeof (script as GroupScript).name === "string" &&
        typeof (script as GroupScript).run === "string",
    )
  );
}

/** Groupes du projet ; absents, aucun. Un fichier qui n'est pas du JSON refuse la lecture, pour ne pas être écrasé. */
export async function readGroups(root: string): Promise<ScriptGroup[]> {
  let raw: string;
  try {
    raw = await readFile(groupsFile(root), "utf8");
  } catch {
    return [];
  }
  const parsed = JSON.parse(raw) as { groups?: unknown };
  return Array.isArray(parsed.groups) ? parsed.groups.filter(valid) : [];
}

export async function writeGroups(root: string, groups: ScriptGroup[]): Promise<void> {
  const file = groupsFile(root);
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ version: 1, groups: groups.filter(valid) }, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

/** Chemin d'un dossier de script tel qu'un groupe le range : relatif au projet, séparé par `/`. */
export function toGroupDirectory(root: string, directory: string): string {
  return relative(root, directory).split("\\").join("/");
}

/** Dossier absolu d'un script de groupe, pour le lancer. */
export function fromGroupDirectory(root: string, directory: string): string {
  return isAbsolute(directory) ? directory : resolve(root, directory);
}
