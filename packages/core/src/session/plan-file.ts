import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { claudeHome, isInside } from "../paths.js";
import { planProgress, type PlanLookup } from "./plan.js";

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
