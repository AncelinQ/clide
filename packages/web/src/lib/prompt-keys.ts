/**
 * Touches des prompts enregistrés.
 *
 * Un numéro n'a pas de stockage propre : c'est le raccourci de la commande du
 * prompt, rangé avec les autres dans `shortcuts`. Une entrée `null` dit « aucune
 * touche », une entrée absente « jamais numéroté ». Comme toute touche, il est à
 * l'utilisateur : rien ne l'écrit dans le fichier versionné du projet.
 */

/** Ce qu'il faut savoir d'un prompt pour ses touches. */
export interface KeyedPrompt {
  id: string;
  label: string;
  scope: "user" | "project";
}

/** Les touches données d'office, de la rangée des chiffres. */
export const PROMPT_KEYS: readonly string[] = Array.from({ length: 9 }, (_, index) => `Ctrl+Shift+${index + 1}`);

/** La touche qui ouvre la liste des prompts, voisine des numéros. */
export const LIST_KEY = "Ctrl+Shift+0";

const PREFIX = "prompt.run:";

/** Commande d'un prompt, celle dont `shortcuts` garde la touche. */
export function promptCommand(id: string): string {
  return `${PREFIX}${id}`;
}

/**
 * Entrées à ajouter à `shortcuts` pour les prompts jamais numérotés, dans l'ordre
 * de la liste, ou rien s'il n'y en a pas.
 *
 * Un prompt prend la première touche qui n'est ni à un prompt d'ici ni à une
 * autre commande. Ceux d'autres projets ne comptent pas : invisibles ici, ils ne
 * gênent rien, et chez eux leur touche passe devant celle d'un prompt perso. Sans
 * touche libre, l'entrée vaut `null` : le prompt n'en reçoit plus d'office, et un
 * numéro libéré attend le prochain prompt créé.
 */
export function numberNew(prompts: readonly { id: string }[], overrides: Record<string, string | null>): Record<string, string | null> | undefined {
  const here = new Set(prompts.map((prompt) => promptCommand(prompt.id)));
  const taken = new Set(
    Object.entries(overrides)
      .filter(([id, key]) => key !== null && (here.has(id) || !id.startsWith(PREFIX)))
      .map(([, key]) => key),
  );
  const added: Record<string, string | null> = {};
  for (const prompt of prompts) {
    const id = promptCommand(prompt.id);
    if (id in overrides) continue;
    const key = PROMPT_KEYS.find((candidate) => !taken.has(candidate)) ?? null;
    added[id] = key;
    if (key) taken.add(key);
  }
  return Object.keys(added).length > 0 ? added : undefined;
}

/**
 * Prompt du projet qui prend la touche de chaque prompt perso, par identifiant de
 * celui-ci : dans le projet, c'est le sien qui part.
 */
export function shadowedBy<T extends KeyedPrompt>(prompts: readonly T[], overrides: Record<string, string | null>): Record<string, T> {
  const keyOf = (prompt: KeyedPrompt) => overrides[promptCommand(prompt.id)] ?? undefined;
  const shadowed: Record<string, T> = {};
  for (const prompt of prompts) {
    const key = keyOf(prompt);
    if (prompt.scope !== "user" || !key) continue;
    const owner = prompts.find((other) => other.scope === "project" && keyOf(other) === key);
    if (owner) shadowed[prompt.id] = owner;
  }
  return shadowed;
}

/**
 * Vrai si des commandes portées par une même touche ne sont qu'un prompt du projet
 * devant des prompts perso : c'est la règle, pas un conflit.
 */
export function isShadowing(ids: readonly string[], prompts: readonly KeyedPrompt[]): boolean {
  const scopes = ids.map((id) => (id.startsWith(PREFIX) ? prompts.find((prompt) => promptCommand(prompt.id) === id)?.scope : undefined));
  return scopes.every((scope) => scope !== undefined) && scopes.filter((scope) => scope === "project").length === 1;
}
