import type { TranscriptEvent } from "../transcript/events.js";

/** Image portée par une entrée : une capture rendue par un outil, ou collée dans un prompt. */
export interface ActivityImage {
  mediaType: string;
  /** Contenu en base64. */
  data: string;
}

/** Nombre d'images d'une entrée ; leur contenu n'est rendu qu'avec `images: true`. */
interface Pictured {
  images?: number;
  imageData?: ActivityImage[];
}

export type ActivityEntry =
  | ({ kind: "prompt"; at?: string; text: string } & Pictured)
  | { kind: "command"; at?: string; text: string }
  | { kind: "answer"; at?: string; text: string; model?: string }
  | ({
      kind: "tool";
      at?: string;
      name: string;
      summary: string;
      failed?: boolean;
      /** Sous-agent lancé par cet appel, dont le transcript porte le détail. */
      agentId?: string;
    } & Pictured)
  | { kind: "note"; at?: string; text: string }
  | {
      kind: "handback";
      at?: string;
      /** Type du sous-agent (`Explore`…), quand le transcript le dit. */
      agent?: string;
      /** Sous-agent lancé par un appel de la session, dont le transcript porte le détail. */
      agentId?: string;
      text: string;
    }
  | {
      kind: "message";
      at?: string;
      /** Une autre session ou un agent coéquipier (`peer`), ou le coordinateur. */
      sender: "peer" | "coordinator";
      /** Nom de l'expéditeur, quand il en a un. */
      from?: string;
      text: string;
    };

export interface ActivityFeed {
  entries: ActivityEntry[];
  /** Nombre total d'entrées produites, avant la coupe à `limit`. */
  total: number;
  /** Contenu entier de chaque entrée, avant la coupe, avec `details: true`. */
  details?: ActivityDetail[];
}

/**
 * Une entrée de l'activité en entier : le texte tel qu'écrit, ou l'appel d'outil
 * avec son entrée et ce qu'il a rendu.
 */
export type ActivityDetail =
  | { kind: "prompt" | "command" | "answer" | "note" | "handback" | "message"; text: string }
  | { kind: "tool"; name: string; input?: Record<string, unknown>; result?: string; failed?: boolean };

/** Ce qu'un résultat d'outil garde au plus : une sortie de build peut peser des mégaoctets. */
const RESULT_MAX = 50_000;

/** Texte d'un résultat d'outil, qu'il soit une chaîne ou une suite de blocs. */
function resultText(content: unknown): string | undefined {
  let text: string | undefined;
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) {
    text = (content as Record<string, unknown>[])
      .map((block) => (block?.["type"] === "text" && typeof block["text"] === "string" ? block["text"] : ""))
      .filter(Boolean)
      .join("\n");
  }
  if (!text) return undefined;
  return text.length > RESULT_MAX ? `${text.slice(0, RESULT_MAX)}\n…` : text;
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

/** Types d'image rendus tels quels ; un autre type n'est pas montré. */
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

function imagesIn(content: unknown): ActivityImage[] {
  if (!Array.isArray(content)) return [];
  const out: ActivityImage[] = [];
  for (const block of content as Record<string, unknown>[]) {
    const source = block?.["type"] === "image" ? (block["source"] as Record<string, unknown> | undefined) : undefined;
    const mediaType = source?.["media_type"];
    const data = source?.["data"];
    if (typeof mediaType === "string" && IMAGE_TYPES.has(mediaType) && typeof data === "string") {
      out.push({ mediaType, data });
    }
  }
  return out;
}

function picture(entry: Pictured, found: ActivityImage[], keep: boolean): void {
  if (found.length === 0) return;
  entry.images = (entry.images ?? 0) + found.length;
  if (keep) entry.imageData = [...(entry.imageData ?? []), ...found];
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

/** Ce qu'une entrée relayée devient, hors de son texte. */
type RelayedEntry =
  | { kind: "handback"; agent?: string; agentId?: string }
  | { kind: "message"; sender: "peer" | "coordinator"; from?: string }
  | { kind: "note" };

interface Relayed {
  entry: RelayedEntry;
  /** Ce que la ligne de l'activité résume. */
  shown: string;
  /** Le détail de l'entrée. */
  full: string;
}

const REPORT_START = "The report follows:\n";

/** La phrase par laquelle Claude Code annonce un message qu'il relaie. */
const ANNOUNCE = /^(?:Another Claude session|The coordinator) sent a message[^\n]*\n/;

/** Note du harnais en tête d'un compte rendu (« instruction-shaped pattern… ») : pas le compte rendu. */
const HARNESS_NOTE = /^(?:\s*\[harness:[^\n]*\]\s*(?:\n|$))+/;

function contentText(event: TranscriptEvent): string {
  return blocks(event)
    .flatMap((block) => (block.type === "text" && block.text ? [block.text] : []))
    .join("\n");
}

/**
 * Le compte rendu d'un sous-agent, sans le cadre que Claude Code met autour : son
 * préambule, qui rappelle que ce n'est pas l'utilisateur qui parle, et le retrait
 * de deux espaces de chaque ligne.
 */
function reportOf(origin: Record<string, unknown>): string {
  const text = origin["handbackReportText"];
  if (typeof text === "string") return text.trim();
  const body = typeof origin["body"] === "string" ? origin["body"] : "";
  const at = body.indexOf(REPORT_START);
  if (at < 0) return body.trim();
  return body
    .slice(at + REPORT_START.length)
    .split("\n")
    .map((line) => line.replace(/^ {2}/, ""))
    .join("\n")
    .trim();
}

/**
 * Un message `user` que l'utilisateur n'a pas tapé, reconnu à son `origin` :
 * Claude Code y range ce qu'il remet de lui-même à la session. Le compte rendu
 * d'un sous-agent (`peer` avec `handback`), le message d'une autre session ou du
 * coordinateur, la fin d'une tâche de fond. `human`, ou pas d'`origin`, est un
 * vrai prompt.
 *
 * `agents` donne le type de chaque sous-agent lancé par la session : un compte
 * rendu ne le nomme pas toujours, mais porte l'identifiant de son sous-agent.
 */
function relayed(event: TranscriptEvent, agents: ReadonlyMap<string, string>): Relayed | undefined {
  const origin = event["origin"];
  if (!origin || typeof origin !== "object") return undefined;
  const record = origin as Record<string, unknown>;
  const name = typeof record["name"] === "string" && record["name"] ? record["name"] : undefined;

  switch (record["kind"]) {
    case "peer": {
      if (record["handback"] !== true) {
        const body = typeof record["body"] === "string" ? record["body"] : contentText(event).replace(ANNOUNCE, "");
        return { entry: { kind: "message", sender: "peer", ...(name ? { from: name } : {}) }, shown: body, full: body.trim() };
      }
      const from = record["from"];
      const agentId = typeof from === "string" && agents.has(from) ? from : undefined;
      const agent = name ?? (agentId ? agents.get(agentId) : undefined);
      const report = reportOf(record);
      return {
        entry: { kind: "handback", ...(agent ? { agent } : {}), ...(agentId ? { agentId } : {}) },
        shown: report.replace(HARNESS_NOTE, ""),
        full: report,
      };
    }
    case "coordinator": {
      const text = contentText(event).replace(ANNOUNCE, "").trim();
      return { entry: { kind: "message", sender: "coordinator" }, shown: text, full: text };
    }
    case "task-notification": {
      const content = contentText(event);
      const summary = /<summary>([\s\S]*?)<\/summary>/.exec(content)?.[1]?.trim();
      const result = /<result>([\s\S]*?)<\/result>/.exec(content)?.[1]?.trim();
      if (!summary) return { entry: { kind: "note" }, shown: content, full: content.trim() };
      return { entry: { kind: "note" }, shown: summary, full: result ? `${summary}\n\n${result}` : summary };
    }
    default:
      return undefined;
  }
}

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
    /** Contenu des images en plus de leur nombre : lourd, réservé à qui les montre. */
    images?: boolean;
    /** Contenu entier de chaque entrée, pour en montrer le détail. */
    details?: boolean;
  } = {},
): ActivityFeed {
  const textMax = options.full ? 20_000 : 400;
  const toolMax = options.full ? 4_000 : 160;
  const entries: ActivityEntry[] = [];
  const toolByUseId = new Map<string, ActivityEntry & { kind: "tool" }>();
  // Rempli au même endroit que `entries` : l'indice d'une entrée désigne son détail.
  const details: ActivityDetail[] | undefined = options.details ? [] : undefined;
  const detailByUseId = new Map<string, ActivityDetail & { kind: "tool" }>();
  // Type de chaque sous-agent : par appel tant qu'il n'a pas répondu, puis par identifiant.
  const agentTypeByUseId = new Map<string, string>();
  const agentTypes = new Map<string, string>();

  for (const event of events) {
    const at = typeof event.timestamp === "string" ? event.timestamp : undefined;

    if (event.type === "user") {
      const relay = relayed(event, agentTypes);
      if (relay) {
        entries.push({ ...relay.entry, ...(at ? { at } : {}), text: condense(relay.shown, textMax) });
        details?.push({ kind: relay.entry.kind, text: relay.full });
        continue;
      }
      // La réponse d'un appel à un sous-agent porte son identifiant, qui nomme son
      // transcript : c'est le seul lien entre la session et le détail du sous-agent.
      const result = event["toolUseResult"];
      const agentId =
        result && typeof result === "object" && typeof (result as Record<string, unknown>)["agentId"] === "string"
          ? ((result as Record<string, unknown>)["agentId"] as string)
          : undefined;
      let prompt: (ActivityEntry & { kind: "prompt" }) | undefined;
      for (const block of blocks(event)) {
        if (block.type === "tool_result") {
          const tool = block.tool_use_id ? toolByUseId.get(block.tool_use_id) : undefined;
          if (tool && block.is_error) tool.failed = true;
          if (tool && agentId) tool.agentId = agentId;
          const agentType = block.tool_use_id ? agentTypeByUseId.get(block.tool_use_id) : undefined;
          if (agentId && agentType !== undefined) agentTypes.set(agentId, agentType);
          if (tool) picture(tool, imagesIn(block.content), options.images === true);
          const detail = block.tool_use_id ? detailByUseId.get(block.tool_use_id) : undefined;
          if (detail) {
            const result = resultText(block.content);
            if (result) detail.result = result;
            if (block.is_error) detail.failed = true;
          }
          continue;
        }
        if (block.type !== "text" || !block.text) continue;
        const text = condense(block.text, textMax);
        if (SYNTHETIC.test(block.text)) {
          entries.push({ kind: "command", ...(at ? { at } : {}), text });
          details?.push({ kind: "command", text: block.text });
        } else {
          prompt = { kind: "prompt", ...(at ? { at } : {}), text };
          entries.push(prompt);
          details?.push({ kind: "prompt", text: block.text });
        }
      }
      // Une image collée accompagne le texte du prompt, dans le même message : elle
      // s'y rattache plutôt que de faire une entrée à elle seule.
      if (prompt) picture(prompt, imagesIn(blocks(event)), options.images === true);
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
          details?.push({ kind: "answer", text: block.text });
        } else if (block.type === "tool_use" && block.name) {
          const entry: ActivityEntry & { kind: "tool" } = {
            kind: "tool",
            ...(at ? { at } : {}),
            name: block.name,
            summary: summarizeTool(block.name, block.input, toolMax),
          };
          if (block.id) toolByUseId.set(block.id, entry);
          if (block.id && (block.name === "Agent" || block.name === "Task")) {
            agentTypeByUseId.set(block.id, firstString(block.input, ["subagent_type"]) ?? "");
          }
          entries.push(entry);
          if (details) {
            const detail: ActivityDetail & { kind: "tool" } = {
              kind: "tool",
              name: block.name,
              ...(block.input ? { input: block.input } : {}),
            };
            if (block.id) detailByUseId.set(block.id, detail);
            details.push(detail);
          }
        }
      }
      continue;
    }

    if (event.type === "pr-link" && typeof event["prUrl"] === "string") {
      entries.push({ kind: "note", ...(at ? { at } : {}), text: `merge request ${event["prUrl"]}` });
      details?.push({ kind: "note", text: `merge request ${event["prUrl"]}` });
    }
  }

  const limit = options.limit ?? 400;
  return { entries: entries.slice(-limit), total: entries.length, ...(details ? { details } : {}) };
}
