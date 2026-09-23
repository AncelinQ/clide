import type { TranscriptEvent } from "../transcript/events.js";

export type ActivityEntry =
  | { kind: "prompt"; at?: string; text: string }
  | { kind: "command"; at?: string; text: string }
  | { kind: "answer"; at?: string; text: string; model?: string }
  | { kind: "tool"; at?: string; name: string; summary: string; failed?: boolean }
  | { kind: "note"; at?: string; text: string };

export interface ActivityFeed {
  entries: ActivityEntry[];
  /** Nombre total d'entrées produites, avant la coupe à `limit`. */
  total: number;
}

interface Block {
  type?: string;
  text?: string;
  name?: string;
  id?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  is_error?: boolean;
  content?: unknown;
}

function blocks(event: TranscriptEvent): Block[] {
  const message = event["message"];
  if (!message || typeof message !== "object") return [];
  const content = (message as Record<string, unknown>)["content"];
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? (content as Block[]) : [];
}

function modelOf(event: TranscriptEvent): string | undefined {
  const message = event["message"];
  if (!message || typeof message !== "object") return undefined;
  const model = (message as Record<string, unknown>)["model"];
  return typeof model === "string" ? model : undefined;
}

function firstString(input: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!input) return undefined;
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function condense(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * Résumé d'un appel d'outil.
 *
 * Le corpus de référence compte 67 outils distincts, MCP compris, et la liste
 * s'allonge à chaque serveur ajouté. Un rendu par outil serait donc toujours en
 * retard : la règle générale prend le premier champ parlant de l'entrée, et seuls
 * quelques outils très fréquents méritent d'être nommés à part.
 */
export function summarizeTool(name: string, input: Record<string, unknown> | undefined, max = 160): string {
  const pick = (keys: string[]): string | undefined => firstString(input, keys);

  switch (name) {
    case "Bash":
    case "PowerShell":
      return condense(pick(["command"]) ?? "", max);
    case "Read":
    case "Write":
    case "Edit":
    case "NotebookEdit":
      return condense(pick(["file_path", "notebook_path"]) ?? "", max);
    case "Grep":
      return condense([pick(["pattern"]), pick(["path", "glob"])].filter(Boolean).join(" · "), max);
    case "Glob":
      return condense(pick(["pattern"]) ?? "", max);
    case "Agent":
    case "Task":
      return condense(pick(["description", "prompt"]) ?? "", max);
    case "Skill":
      return condense(pick(["skill", "args"]) ?? "", max);
    default:
      return condense(
        pick(["description", "command", "file_path", "pattern", "url", "query", "prompt", "name"]) ??
          "",
        max,
      );
  }
}

/**
 * Un contenu utilisateur qui commence par une balise de ce genre n'a pas été tapé
 * par l'utilisateur : c'est le harnais qui injecte le texte d'une commande ou un
 * rappel. Le présenter comme un prompt donnerait une histoire fausse de la session.
 */
const SYNTHETIC = /^\s*<(local-command-caveat|command-message|command-name|system-reminder)/;

/**
 * Construit le déroulé lisible d'une session.
 *
 * Les blocs de réflexion sont comptés mais pas rendus : leur contenu est souvent
 * vide dans le transcript, et leur signature n'apprend rien. Le résultat d'un
 * outil ne crée pas d'entrée — il marque en échec l'appel correspondant, pour que
 * le flux garde une ligne par action plutôt qu'une paire par action.
 */
export function buildActivity(
  events: Iterable<TranscriptEvent>,
  options: {
    limit?: number;
    /**
     * Textes entiers plutôt que résumés, pour la recherche. Les entrées restent
     * les mêmes et dans le même ordre : la position d'un résultat désigne la même
     * ligne de l'activité affichée.
     */
    full?: boolean;
  } = {},
): ActivityFeed {
  const textMax = options.full ? 20_000 : 400;
  const toolMax = options.full ? 4_000 : 160;
  const entries: ActivityEntry[] = [];
  const toolByUseId = new Map<string, ActivityEntry & { kind: "tool" }>();

  for (const event of events) {
    const at = typeof event.timestamp === "string" ? event.timestamp : undefined;

    if (event.type === "user") {
      for (const block of blocks(event)) {
        if (block.type === "tool_result") {
          const tool = block.tool_use_id ? toolByUseId.get(block.tool_use_id) : undefined;
          if (tool && block.is_error) tool.failed = true;
          continue;
        }
        if (block.type !== "text" || !block.text) continue;
        const text = condense(block.text, textMax);
        entries.push(
          SYNTHETIC.test(block.text)
            ? { kind: "command", ...(at ? { at } : {}), text }
            : { kind: "prompt", ...(at ? { at } : {}), text },
        );
      }
      continue;
    }

    if (event.type === "assistant") {
      const model = modelOf(event);
      for (const block of blocks(event)) {
        if (block.type === "text" && block.text) {
          entries.push({
            kind: "answer",
            ...(at ? { at } : {}),
            text: condense(block.text, textMax),
            ...(model ? { model } : {}),
          });
        } else if (block.type === "tool_use" && block.name) {
          const entry: ActivityEntry & { kind: "tool" } = {
            kind: "tool",
            ...(at ? { at } : {}),
            name: block.name,
            summary: summarizeTool(block.name, block.input, toolMax),
          };
          if (block.id) toolByUseId.set(block.id, entry);
          entries.push(entry);
        }
      }
      continue;
    }

    if (event.type === "pr-link" && typeof event["prUrl"] === "string") {
      entries.push({ kind: "note", ...(at ? { at } : {}), text: `merge request ${event["prUrl"]}` });
    }
  }

  const limit = options.limit ?? 400;
  return { entries: entries.slice(-limit), total: entries.length };
}
