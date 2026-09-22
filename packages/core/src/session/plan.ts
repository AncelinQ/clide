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
 * Claude Code n'écrit plus de fichier de plan : `~/.claude/plans` n'existe pas
 * sur cette version. Le plan vit donc là où il est produit — l'appel à
 * `ExitPlanMode`, dont l'entrée porte le texte soumis à validation.
 *
 * Le dernier plan l'emporte : une session peut repasser en mode plan et en
 * proposer un autre, et c'est celui-là qui décrit le travail en cours.
 */
export function extractPlan(events: Iterable<TranscriptEvent>): PlanLookup {
  let plan: SessionPlan | undefined;
  let mode: string | undefined;
  let planModeEntries = 0;

  for (const event of events) {
    if (event.type === "mode" || event.type === "permission-mode") {
      const value = event["mode"] ?? event["permissionMode"];
      if (typeof value === "string") {
        mode = value;
        if (value === "plan") planModeEntries += 1;
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

  return { ...(plan ? { plan } : {}), ...(mode ? { mode } : {}), planModeEntries };
}
