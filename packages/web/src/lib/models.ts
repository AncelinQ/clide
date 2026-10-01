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

/** Sans sa date ni le suffixe de contexte : `claude-haiku-4-5-20251001`, `opus[1m]`. */
const bare = (id: string): string => id.replace(/\[1m\]$/i, "").replace(/-\d{8}$/, "");

/** Famille d'un identifiant complet (`claude-opus-5-5` → `opus`) ; un alias est la sienne. */
const family = (id: string): string => /^claude-([a-z]+)-/.exec(id)?.[1] ?? id;

/**
 * Le modèle du catalogue que désigne celui d'une session : un identifiant avec
 * ou sans date, le nom qu'affiche le sélecteur de `/model` (`Opus 5 (1M context)`),
 * ou un alias de famille (`opus`), qui désigne le premier de la famille au
 * catalogue — le plus récent. Un préfixe ne suffit pas : `claude-opus-5` n'est
 * pas `claude-opus-5-5`.
 */
export function findModel(models: ModelChoice[], used: string | undefined): ModelChoice | undefined {
  if (!used) return undefined;
  const id = bare(used);
  const name = used.replace(/\s*\(.*\)$/, "");
  const alias = (value: string) => !value.startsWith("claude-");
  return (
    models.find((model) => bare(model.id) === id || model.name === name) ??
    models.find((model) => (alias(id) && family(model.id) === id) || (alias(model.id) && model.id === family(id)))
  );
}
