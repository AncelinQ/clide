import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { claudeHome, isInside } from "../paths.js";
import { planProgress, type PlanLookup, type SessionPlan } from "./plan.js";

export interface PlanFileInfo {
  path: string;
  name: string;
  modifiedAt: string;
  /** Premier titre markdown du fichier, quand il en a un. */
  title?: string;
}

/** Plans de `~/.claude/plans`, du plus récent au plus ancien. */
export async function listPlans(home: string = claudeHome()): Promise<PlanFileInfo[]> {
  const directory = join(home, "plans");
  let names: string[];
  try {
    names = (await readdir(directory)).filter((name) => name.endsWith(".md"));
  } catch {
    return [];
  }
  const out: PlanFileInfo[] = [];
  for (const name of names) {
    const path = join(directory, name);
    try {
      const info = await stat(path);
      if (!info.isFile()) continue;
      const head = (await readFile(path, "utf8")).slice(0, 2000);
      const title = head
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.startsWith("# "))
        ?.slice(2)
        .trim();
      out.push({ path, name, modifiedAt: new Date(info.mtimeMs).toISOString(), ...(title ? { title } : {}) });
    } catch {
      // Disparu entre la liste et la lecture.
    }
  }
  return out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

/** Un plan de `~/.claude/plans` désigné par son chemin ; rien en dehors de ce dossier. */
export async function readPlanFile(path: string, home: string = claudeHome()): Promise<SessionPlan | undefined> {
  if (!isInside(join(home, "plans"), path)) return undefined;
  try {
    const info = await stat(path);
    if (!info.isFile()) return undefined;
    const text = await readFile(path, "utf8");
    const progress = planProgress(text);
    return { text, at: new Date(info.mtimeMs).toISOString(), ...(progress ? { progress } : {}) };
  } catch {
    return undefined;
  }
}

/**
 * Complète un plan avec le fichier que Claude Code rédige en mode plan.
 *
 * Le fichier est ce que Claude écrit au fil de la réflexion ; l'appel à
 * `ExitPlanMode` en fige une version. Le plus récent des deux décrit le travail en
 * cours. Seul un fichier sous `~/.claude/plans` est lu : le chemin vient du
 * transcript, et rien ne justifie d'aller lire ailleurs.
 */
export async function withPlanFile(lookup: PlanLookup, home: string = claudeHome()): Promise<PlanLookup> {
  const path = lookup.planFilePath;
  if (!path || !isInside(join(home, "plans"), path)) return lookup;

  let text: string;
  let modifiedAt: number;
  try {
    const info = await stat(path);
    if (!info.isFile()) return lookup;
    modifiedAt = info.mtimeMs;
    text = await readFile(path, "utf8");
  } catch {
    // Annoncé mais jamais écrit : Claude n'a pas encore rédigé de plan.
    return lookup;
  }
  if (text.trim().length === 0) return lookup;

  const submitted = lookup.plan?.at ? Date.parse(lookup.plan.at) : Number.NEGATIVE_INFINITY;
  if (lookup.plan && submitted >= modifiedAt) return lookup;

  const progress = planProgress(text);
  return {
    ...lookup,
    plan: { text, at: new Date(modifiedAt).toISOString(), ...(progress ? { progress } : {}) },
  };
}
