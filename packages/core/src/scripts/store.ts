import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

export type PackageManager = "pnpm" | "npm" | "yarn" | "bun";

export interface PackageScript {
  name: string;
  command: string;
}

export interface ScriptSource {
  /** Chemin du dossier contenant le `package.json`. */
  directory: string;
  /** Chemin relatif à la racine du projet, vide pour la racine. */
  relativePath: string;
  packageName?: string;
  scripts: PackageScript[];
}

export interface ProjectScripts {
  root: string;
  manager: PackageManager;
  /** Vrai quand le gestionnaire vient d'un lockfile plutôt que du défaut. */
  managerDetected: boolean;
  sources: ScriptSource[];
}

/** Lockfile de chaque gestionnaire, dans l'ordre où ils sont examinés. */
const LOCKFILES: [PackageManager, string][] = [
  ["pnpm", "pnpm-lock.yaml"],
  ["bun", "bun.lockb"],
  ["yarn", "yarn.lock"],
  ["npm", "package-lock.json"],
];

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson(file: string): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Motifs d'espaces de travail de `pnpm-workspace.yaml`.
 *
 * Extrait la liste `packages:` sans analyseur YAML : le fichier ne contient en
 * pratique qu'une liste de chaînes. Un fichier plus riche verrait ses autres
 * clés ignorées, ce qui dégrade l'inventaire sans le fausser.
 */
export function parsePnpmWorkspace(text: string): string[] {
  const globs: string[] = [];
  let inPackages = false;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").trimEnd();
    if (/^packages\s*:/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      const item = /^\s+-\s*(.+)$/.exec(line);
      if (item?.[1]) {
        globs.push(item[1].trim().replace(/^["'](.*)["']$/, "$1"));
        continue;
      }
      if (line.trim().length > 0) inPackages = false;
    }
  }
  return globs;
}

/**
 * Développe un motif d'espace de travail.
 *
 * Seules les formes réellement utilisées sont gérées : un chemin littéral, et un
 * `*` en dernier segment. Un motif plus complexe est ignoré plutôt qu'à moitié
 * interprété, ce qui donnerait un inventaire faux.
 */
async function expandGlob(root: string, glob: string): Promise<string[]> {
  const normalized = glob.replace(/\\/g, "/").replace(/\/+$/, "");
  if (normalized.startsWith("!")) return [];

  const star = normalized.indexOf("*");
  if (star === -1) {
    return (await exists(join(root, normalized, "package.json"))) ? [normalized] : [];
  }
  if (!normalized.endsWith("/*")) return [];

  const parent = normalized.slice(0, -2);
  try {
    const entries = await readdir(join(root, parent), { withFileTypes: true });
    const out: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = parent.length > 0 ? `${parent}/${entry.name}` : entry.name;
      if (await exists(join(root, candidate, "package.json"))) out.push(candidate);
    }
    return out;
  } catch {
    return [];
  }
}

function scriptsOf(pkg: Record<string, unknown> | undefined): PackageScript[] {
  const scripts = pkg?.["scripts"];
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) return [];
  return Object.entries(scripts as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([name, command]) => ({ name, command }));
}

/**
 * Scripts npm d'un projet, espaces de travail compris.
 *
 * Le gestionnaire est déduit du lockfile présent, jamais supposé : lancer un
 * script avec `pnpm` dans un dépôt verrouillé par npm réécrit son arbre de
 * dépendances. En l'absence de lockfile, `npm` sert de défaut et `managerDetected`
 * dit que c'en est un.
 */
export class ScriptStore {
  static async detectManager(root: string): Promise<{ manager: PackageManager; detected: boolean }> {
    for (const [manager, lockfile] of LOCKFILES) {
      if (await exists(join(root, lockfile))) return { manager, detected: true };
    }
    return { manager: "npm", detected: false };
  }

  static async workspaceGlobs(root: string): Promise<string[]> {
    const globs: string[] = [];

    try {
      globs.push(...parsePnpmWorkspace(await readFile(join(root, "pnpm-workspace.yaml"), "utf8")));
    } catch {
      // Pas d'espaces de travail pnpm.
    }

    const pkg = await readJson(join(root, "package.json"));
    const declared = pkg?.["workspaces"];
    if (Array.isArray(declared)) {
      globs.push(...declared.filter((item): item is string => typeof item === "string"));
    } else if (declared && typeof declared === "object") {
      const packages = (declared as Record<string, unknown>)["packages"];
      if (Array.isArray(packages)) {
        globs.push(...packages.filter((item): item is string => typeof item === "string"));
      }
    }
    return [...new Set(globs)];
  }

  async read(root: string): Promise<ProjectScripts> {
    const { manager, detected } = await ScriptStore.detectManager(root);
    const sources: ScriptSource[] = [];

    const rootPkg = await readJson(join(root, "package.json"));
    if (rootPkg) {
      const name = rootPkg["name"];
      sources.push({
        directory: root,
        relativePath: "",
        ...(typeof name === "string" ? { packageName: name } : {}),
        scripts: scriptsOf(rootPkg),
      });
    }

    const globs = await ScriptStore.workspaceGlobs(root);
    const seen = new Set<string>();
    for (const glob of globs) {
      for (const found of await expandGlob(root, glob)) {
        if (seen.has(found)) continue;
        seen.add(found);
        const directory = join(root, found.split("/").join(sep));
        const pkg = await readJson(join(directory, "package.json"));
        const name = pkg?.["name"];
        sources.push({
          directory,
          relativePath: relative(root, directory),
          ...(typeof name === "string" ? { packageName: name } : {}),
          scripts: scriptsOf(pkg),
        });
      }
    }

    return { root, manager, managerDetected: detected, sources };
  }

  /** Ligne de commande à exécuter pour un script, dans le dossier de sa source. */
  static runCommand(manager: PackageManager, script: string): string {
    return manager === "npm" ? `npm run ${script}` : `${manager} run ${script}`;
  }
}
