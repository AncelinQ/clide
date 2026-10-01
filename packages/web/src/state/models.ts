import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { ModelChoice } from "@/lib/models";

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
