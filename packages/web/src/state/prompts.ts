import { t } from "@/i18n";
import { api } from "@/lib/api";
import { expand, variablesOf, type PromptVariable } from "@/lib/prompt-vars";
import { selectedText } from "@/state/editor";
import { getState, setState } from "@/state/store";
import { claudeTabFor, focusTerminal, openTerminal, typeInto } from "@/state/terminals";

export interface SavedPrompt {
  id: string;
  label: string;
  text: string;
  mode: "insert" | "send";
  scope: "user" | "project";
}

/**
 * Prompts connus du projet actif et de l'utilisateur, gardés ici pour la palette
 * et les raccourcis, qui les demandent sans attendre le serveur.
 */
let cached: { root: string | null; prompts: SavedPrompt[] } = { root: null, prompts: [] };
const listeners = new Set<() => void>();

export function cachedPrompts(): SavedPrompt[] {
  return cached.prompts;
}

export function onPromptsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function loadPrompts(root = getState().activeRoot): Promise<SavedPrompt[]> {
  const { prompts } = await api<{ prompts: SavedPrompt[] }>("/api/prompts", root ? { root } : {});
  cached = { root, prompts };
  for (const listener of listeners) listener();
  return prompts;
}

/** Valeur d'une variable, ou rien si elle n'en a pas là où l'on est. */
async function valueOf(variable: PromptVariable, label: string): Promise<string | undefined> {
  const { projects, activeRoot } = getState();
  const project = projects.find((item) => item.root === activeRoot);
  switch (variable) {
    case "sélection":
      return selectedText() || undefined;
    case "fichier":
      return project?.activeFile && !project.activeFile.startsWith("diff:") ? project.activeFile : undefined;
    case "branche": {
      if (!activeRoot) return undefined;
      const { status } = await api<{ status: { branch?: string } | null }>("/api/git/status", { root: activeRoot });
      return status?.branch;
    }
    case "saisie":
      return askInput(label);
  }
}

/** Demande la valeur de `{saisie}` : la fenêtre montée par l'application répond. */
function askInput(label: string): Promise<string | undefined> {
  return new Promise((resolve) => setState({ promptInput: { label, resolve } }));
}

const VARIABLE_LABEL: Record<PromptVariable, string> = {
  sélection: "aucun texte n'est sélectionné dans l'éditeur",
  fichier: "aucun fichier n'est ouvert au centre",
  branche: "le projet n'est pas sur une branche git",
  saisie: "la saisie a été annulée",
};

/**
 * Envoie un prompt enregistré à l'onglet Claude du projet : tapé tel quel en
 * mode `insert`, pour le compléter, validé en mode `send`. Sans onglet Claude,
 * un onglet s'ouvre avec le prompt en argument de `claude`, qui l'envoie.
 * Rend un message quand quelque chose manque.
 */
export async function runPrompt(prompt: SavedPrompt): Promise<string | undefined> {
  const values: Partial<Record<PromptVariable, string>> = {};
  for (const variable of variablesOf(prompt.text)) {
    const value = await valueOf(variable, prompt.label);
    if (value === undefined) return t("« {label} » attend une valeur : {reason}.", { label: prompt.label, reason: t(VARIABLE_LABEL[variable]) });
    values[variable] = value;
  }
  const result = expand(prompt.text, values);
  if ("missing" in result) return t("« {label} » attend une valeur.", { label: prompt.label });

  const id = claudeTabFor(getState().activeRoot);
  // Insérer, c'est taper sans valider : sans onglet Claude, il n'y a rien où taper.
  if (!id && prompt.mode === "insert") return t("Ouvre un onglet Claude dans ce projet pour y insérer « {text} ».", { text: result.text.trim() });
  if (!id) {
    // Tapé dans PowerShell : une ligne, entre apostrophes doublées.
    const argument = result.text.replace(/\s*\n\s*/g, " ").replace(/'/g, "''");
    openTerminal("claude", { command: `claude '${argument}'` });
    return undefined;
  }
  typeInto(id, result.text);
  // Entrée part à part : reçue avec le texte, Claude Code la lirait comme un saut de ligne collé.
  if (prompt.mode === "send") setTimeout(() => typeInto(id, "\r"), 150);
  focusTerminal(id);
  return undefined;
}
