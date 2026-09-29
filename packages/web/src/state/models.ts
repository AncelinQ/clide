import { useEffect, useState } from "react";

import { api } from "@/lib/api";

export interface EffortChoice {
  id: string;
  name: string;
  recommended?: boolean;
}

export interface ModelChoice {
  id: string;
  name: string;
  description?: string;
  main: boolean;
  /** Vide : le modèle n'a pas d'effort réglable. Absent : le catalogue manque. */
  efforts?: EffortChoice[];
}

/** Les niveaux que `/effort` accepte, quand le catalogue ne dit pas ceux du modèle. */
const EFFORTS: EffortChoice[] = [
  { id: "low", name: "Low" },
  { id: "medium", name: "Medium" },
  { id: "high", name: "High" },
  { id: "xhigh", name: "Extra" },
  { id: "max", name: "Max" },
];

/** Niveaux d'effort proposés pour un modèle, connu ou non. */
export function effortsFor(model: ModelChoice | undefined): EffortChoice[] {
  return model?.efforts ?? EFFORTS;
}

/** Catalogue lu une fois par page : il ne change qu'aux mises à jour de Claude Code. */
let catalog: Promise<ModelChoice[]> | undefined;

export function loadModels(): Promise<ModelChoice[]> {
  catalog ??= api<{ models: ModelChoice[] }>("/api/models")
    .then((result) => result.models)
    .catch(() => {
      catalog = undefined;
      return [];
    });
  return catalog;
}

/** Les modèles que Claude Code propose, une fois chargés ; vide avant. */
export function useModels(): ModelChoice[] {
  const [models, setModels] = useState<ModelChoice[]>([]);
  useEffect(() => {
    void loadModels().then(setModels);
  }, []);
  return models;
}

/**
 * Le modèle d'une réponse s'écrit avec sa date (`claude-haiku-4-5-20251001`) ou
 * sans ; un alias (`opus`) désigne une famille. Les deux se rapprochent par préfixe.
 */
export function sameModel(choice: ModelChoice, used: string | undefined): boolean {
  return !!used && (used === choice.id || used.startsWith(`${choice.id}-`) || choice.id.startsWith(`${used}-`));
}
