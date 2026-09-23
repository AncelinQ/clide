import type { TranscriptEvent } from "../transcript/events.js";

export interface PlanProgress {
  done: number;
  total: number;
}

export interface SessionPlan {
  text: string;
  at?: string;
  /** Cases à cocher du plan, quand il en contient. */
  progress?: PlanProgress;
}

export interface PlanLookup {
  plan?: SessionPlan;
  /** Dernier mode connu de la session, pour distinguer « pas de plan » de « jamais passé en mode plan ». */
  mode?: string;
  /** Nombre de passages en mode plan repérés dans le transcript. */
  planModeEntries: number;
  /** Fichier où Claude Code écrit le plan en mode plan, le dernier annoncé. */
  planFilePath?: string;
}

interface Block {
  type?: string;
  name?: string;
  input?: Record<string, unknown>;
}

function blocks(event: TranscriptEvent): Block[] {
  const message = event["message"];
  if (!message || typeof message !== "object") return [];
  const content = (message as Record<string, unknown>)["content"];
  return Array.isArray(content) ? (content as Block[]) : [];
}

/**
 * Compte les cases à cocher d'un plan en markdown.
 *
 * Seules les cases en début de ligne comptent : une paire de crochets au fil du
 * texte n'est pas une tâche, et la compter gonflerait une progression.
 */
export function planProgress(text: string): PlanProgress | undefined {
  const boxes = [...text.matchAll(/^\s*[-*]\s+\[( |x|X)\]/gm)];
  if (boxes.length === 0) return undefined;
  return {
    done: boxes.filter((box) => box[1]?.toLowerCase() === "x").length,
    total: boxes.length,
  };
}

/**
 * Retrouve le plan d'une session.
 *
 * Le texte soumis à validation est l'entrée de l'appel à `ExitPlanMode`. En mode
 * plan, Claude Code annonce aussi par une pièce jointe `plan_mode` le fichier où il
 * rédige le plan : c'est au lecteur de le lire, cette fonction ne touche pas au
 * disque.
 *
 * Le mode d'un tour se lit sur son prompt (`user.permissionMode`) ; l'event
 * `permission-mode`, écrit en fin de tour, est gardé pour les transcripts plus
 * anciens. Un passage en mode plan est compté à l'entrée, pas à chaque tour.
 *
 * Le dernier plan l'emporte : une session peut repasser en mode plan et en
 * proposer un autre, et c'est celui-là qui décrit le travail en cours.
 */
export function extractPlan(events: Iterable<TranscriptEvent>): PlanLookup {
  let plan: SessionPlan | undefined;
  let mode: string | undefined;
  let planModeEntries = 0;
  let planFilePath: string | undefined;
  let inPlan = false;

  const observe = (value: string): void => {
    mode = value;
    if (value === "plan" && !inPlan) planModeEntries += 1;
    inPlan = value === "plan";
  };

  for (const event of events) {
    // `mode` vaut `normal` à chaque tour, sans rapport avec les permissions : il
    // ne compte que s'il annonce le mode plan.
    if (event.type === "mode") {
      if (event["mode"] === "plan") observe("plan");
      continue;
    }

    if (event.type === "permission-mode") {
      const value = event["permissionMode"];
      if (typeof value === "string") observe(value);
      continue;
    }

    if (event.type === "user") {
      const value = event["permissionMode"];
      if (typeof value === "string") observe(value);
      continue;
    }

    if (event.type === "attachment") {
      const attachment = event["attachment"];
      if (attachment && typeof attachment === "object") {
        const record = attachment as Record<string, unknown>;
        if (record["type"] === "plan_mode") {
          observe("plan");
          if (typeof record["planFilePath"] === "string") planFilePath = record["planFilePath"];
        }
      }
      continue;
    }

    if (event.type !== "assistant") continue;
    for (const block of blocks(event)) {
      if (block.type !== "tool_use" || block.name !== "ExitPlanMode") continue;
      const text = block.input?.["plan"];
      if (typeof text !== "string" || text.length === 0) continue;
      const progress = planProgress(text);
      const at = typeof event.timestamp === "string" ? event.timestamp : undefined;
      plan = { text, ...(at ? { at } : {}), ...(progress ? { progress } : {}) };
    }
  }

  return {
    ...(plan ? { plan } : {}),
    ...(mode ? { mode } : {}),
    planModeEntries,
    ...(planFilePath ? { planFilePath } : {}),
  };
}
