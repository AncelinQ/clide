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
 * Comment part un prompt : validé en mode `send` ; tapé pour être complété en
 * mode `insert`, sauf si sa `{saisie}` vient d'être donnée et que l'on a choisi,
 * dans la fenêtre qui la demande, d'envoyer aussitôt — la complétion est faite.
 */
export function departure(prompt: { text: string; mode: "insert" | "send" }, sendAfterInput: boolean): "insert" | "send" {
  if (prompt.mode === "send") return "send";
  return sendAfterInput && variablesOf(prompt.text).includes("saisie") ? "send" : "insert";
}

/** Une variable et les blancs qui la précèdent sur sa ligne : partie vide, elle les emporte. */
const SPACED = /([ \t]*)\{([a-zé]+)\}/gi;

/**
 * Remplace les variables par leurs valeurs. Une variable sans valeur arrête
 * l'envoi plutôt que de partir vide : « explique {sélection} » sans sélection
 * enverrait une demande sans objet. `{saisie}` fait exception : on la donne
 * soi-même, et la laisser vide dit d'envoyer le prompt sans elle, qui perd alors
 * le blanc qui la précédait. Une accolade qui n'est pas une variable connue reste
 * telle quelle.
 */
export function expand(
  text: string,
  values: Partial<Record<PromptVariable, string>>,
): { text: string } | { missing: PromptVariable } {
  for (const variable of variablesOf(text)) {
    const value = values[variable];
    if (value === undefined || (value === "" && variable !== "saisie")) return { missing: variable };
  }
  return {
    text: text
      .replace(SPACED, (whole, space: string, name: string) => {
        const variable = ALIASES[name.toLowerCase()];
        if (!variable) return whole;
        const value = values[variable] ?? "";
        return value ? `${space}${value}` : "";
      })
      .trim(),
  };
}
