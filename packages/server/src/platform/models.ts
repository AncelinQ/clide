import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { claudeHome } from "@clide/core";

/** Un modèle qu'on peut donner à `/model` ou à `claude --model`. */
export interface ModelChoice {
  /** Ce qu'on passe à Claude Code : un identifiant complet, ou un alias. */
  id: string;
  name: string;
  description?: string;
  /** Proposé en premier par Claude Code ; les autres sont des versions antérieures. */
  main: boolean;
}

/**
 * Alias que Claude Code comprend toujours : ils servent quand le catalogue
 * manque, et désignent la dernière version de chaque famille.
 */
const FALLBACK: ModelChoice[] = [
  { id: "opus", name: "Opus", main: true },
  { id: "fable", name: "Fable", main: true },
  { id: "sonnet", name: "Sonnet", main: true },
  { id: "haiku", name: "Haiku", main: true },
];

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
const asString = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined);

/** Modèles d'un catalogue lu, dans son ordre ; ceux de la section `main` d'abord. */
export function modelsFromCatalog(document: unknown): ModelChoice[] {
  const models = asRecord(asRecord(asRecord(document)?.["catalog"])?.["config"])?.["models"];
  if (!Array.isArray(models)) return [];
  const out: ModelChoice[] = [];
  for (const item of models) {
    const model = asRecord(item);
    const id = asString(model?.["id"]);
    if (!id) continue;
    const description = asString(model?.["description"]);
    out.push({
      id,
      name: asString(model?.["name"]) ?? id,
      ...(description ? { description } : {}),
      main: model?.["section"] === "main" || model?.["quick_select"] === true,
    });
  }
  return [...out.filter((model) => model.main), ...out.filter((model) => !model.main)];
}

/**
 * Modèles proposés au compte, lus dans le catalogue que Claude Code met en cache
 * (`cache/model-catalog/<compte>-cc.json`).
 *
 * Ce cache n'est pas documenté : un fichier absent, illisible ou d'une autre
 * forme renvoie les alias, que Claude Code accepte en toutes circonstances.
 */
export async function listModels(
  home: string = claudeHome(),
): Promise<{ models: ModelChoice[]; source: "catalog" | "aliases" }> {
  const directory = join(home, "cache", "model-catalog");
  try {
    const files = (await readdir(directory)).filter((name) => name.endsWith("-cc.json"));
    for (const name of files) {
      const models = modelsFromCatalog(JSON.parse(await readFile(join(directory, name), "utf8")) as unknown);
      if (models.length > 0) return { models, source: "catalog" };
    }
  } catch {
    // Pas de cache : les alias suffisent.
  }
  return { models: FALLBACK, source: "aliases" };
}
