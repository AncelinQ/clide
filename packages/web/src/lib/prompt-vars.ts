/**
 * Variables d'un prompt enregistré, remplacées au moment de l'envoyer. Les noms
 * s'écrivent en français, avec ou sans accent : `{sélection}` et `{selection}`
 * valent la même chose.
 */
export type PromptVariable = "sélection" | "fichier" | "branche" | "saisie";

const ALIASES: Record<string, PromptVariable> = {
  sélection: "sélection",
  selection: "sélection",
  fichier: "fichier",
  branche: "branche",
  saisie: "saisie",
};

const PATTERN = /\{([a-zé]+)\}/gi;

/** Variables que le texte utilise, chacune une fois, dans l'ordre. */
export function variablesOf(text: string): PromptVariable[] {
  const found: PromptVariable[] = [];
  for (const match of text.matchAll(PATTERN)) {
    const variable = ALIASES[(match[1] ?? "").toLowerCase()];
    if (variable && !found.includes(variable)) found.push(variable);
  }
  return found;
}

/**
 * Remplace les variables par leurs valeurs. Une variable sans valeur arrête
 * l'envoi plutôt que de partir vide : « explique {sélection} » sans sélection
 * enverrait une demande sans objet. Une accolade qui n'est pas une variable
 * connue reste telle quelle.
 */
export function expand(
  text: string,
  values: Partial<Record<PromptVariable, string>>,
): { text: string } | { missing: PromptVariable } {
  for (const variable of variablesOf(text)) {
    if (!values[variable]) return { missing: variable };
  }
  return {
    text: text.replace(PATTERN, (whole, name: string) => {
      const variable = ALIASES[name.toLowerCase()];
      return variable ? (values[variable] ?? whole) : whole;
    }),
  };
}
