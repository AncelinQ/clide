import type { TranscriptEvent } from "../transcript/events.js";

/** Ce qu'une session a appris d'un ticket, par les outils Linear de Claude Code. */
export interface TicketTrace {
  title?: string;
  /** Dernier état connu : lu par `get_issue`, ou fixé par `save_issue`. */
  status?: string;
  /** Moment où cet état a été lu ou fixé. */
  statusAt?: string;
  /** L'état vient d'une écriture de Claude, pas d'une lecture. */
  statusSetByClaude?: boolean;
  url?: string;
  /** Branche que Linear associe au ticket. */
  gitBranch?: string;
}

/** Identifiant de ticket, tel que Linear l'écrit : `HN-12528`, `MAR-468`. */
const TICKET = /^[A-Z][A-Z0-9]{1,9}-\d{1,6}$/;
/** Un état désigné par son identifiant plutôt que par son nom ne se montre pas. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

/**
 * Identifiant de ticket porté par un nom de branche.
 *
 * `ancelin/hn-12528-fe-us2-…` et `aqn/feat/hn-13237-dnd` désignent HN-12528 et
 * HN-13237. Le premier segment qui a la forme d'un identifiant l'emporte. Un
 * nombre suivi d'un autre groupe de chiffres est une date — `batch-2026-09-22` —,
 * pas un ticket.
 */
export function ticketOfBranch(branch: string | undefined): string | undefined {
  if (!branch) return undefined;
  const match = branch.match(/(?:^|[/_-])([a-z][a-z0-9]{1,9})-(\d{2,6})(?=$|[/_]|-(?!\d))/i);
  if (!match || !match[1] || !match[2]) return undefined;
  return `${match[1].toUpperCase()}-${match[2]}`;
}

interface PendingCall {
  name: string;
  ticket?: string;
  at?: string;
}

/**
 * Relève, dans un transcript, ce que Claude a lu ou écrit des tickets Linear.
 *
 * Un appel d'outil et sa réponse vivent dans deux events distincts, reliés par
 * l'identifiant de l'appel : la réponse de `get_issue` porte le titre et l'état
 * du ticket, l'appel à `save_issue` porte l'état qu'on lui donne. Le plus récent
 * des deux l'emporte.
 */
export class TicketTracker {
  readonly #pending = new Map<string, PendingCall>();
  readonly #tickets = new Map<string, TicketTrace>();

  apply(event: TranscriptEvent): void {
    const message = event["message"];
    if (!message || typeof message !== "object") return;
    const content = (message as Record<string, unknown>)["content"];
    if (!Array.isArray(content)) return;
    const at = typeof event["timestamp"] === "string" ? event["timestamp"] : undefined;

    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const record = block as Record<string, unknown>;
      if (record["type"] === "tool_use" && typeof record["name"] === "string" && record["name"].startsWith("mcp__linear__")) {
        this.#onCall(record, at);
      } else if (record["type"] === "tool_result" && typeof record["tool_use_id"] === "string") {
        this.#onResult(record, at);
      }
    }
  }

  #onCall(record: Record<string, unknown>, at: string | undefined): void {
    const input = (record["input"] && typeof record["input"] === "object" ? record["input"] : {}) as Record<string, unknown>;
    const raw = input["id"] ?? input["issueId"];
    const ticket = typeof raw === "string" && TICKET.test(raw) ? raw : undefined;
    const name = record["name"] as string;
    if (typeof record["id"] === "string") {
      this.#pending.set(record["id"], { name, ...(ticket ? { ticket } : {}), ...(at ? { at } : {}) });
    }
    if (!ticket) return;
    const trace = this.#trace(ticket);
    const state = input["state"];
    if (name === "mcp__linear__save_issue" && typeof state === "string" && !UUID.test(state)) {
      this.#setStatus(trace, state, at, true);
    }
  }

  #onResult(record: Record<string, unknown>, at: string | undefined): void {
    const call = this.#pending.get(record["tool_use_id"] as string);
    if (!call || call.name !== "mcp__linear__get_issue" || record["is_error"] === true) return;
    this.#pending.delete(record["tool_use_id"] as string);
    const text = Array.isArray(record["content"])
      ? (record["content"] as unknown[])
          .map((part) => (part && typeof part === "object" ? String((part as Record<string, unknown>)["text"] ?? "") : ""))
          .join("")
      : String(record["content"] ?? "");
    let issue: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object") return;
      issue = parsed as Record<string, unknown>;
    } catch {
      return;
    }
    const ticket = typeof issue["id"] === "string" && TICKET.test(issue["id"]) ? issue["id"] : call.ticket;
    if (!ticket) return;
    const trace = this.#trace(ticket);
    if (typeof issue["title"] === "string") trace.title = issue["title"];
    if (typeof issue["url"] === "string") trace.url = issue["url"];
    if (typeof issue["gitBranchName"] === "string") trace.gitBranch = issue["gitBranchName"];
    if (typeof issue["status"] === "string") this.#setStatus(trace, issue["status"], at ?? call.at, false);
  }

  #trace(ticket: string): TicketTrace {
    const existing = this.#tickets.get(ticket);
    if (existing) return existing;
    const created: TicketTrace = {};
    this.#tickets.set(ticket, created);
    return created;
  }

  /** Un état plus ancien que celui qu'on a ne le remplace pas. */
  #setStatus(trace: TicketTrace, status: string, at: string | undefined, byClaude: boolean): void {
    if (trace.statusAt && at && at < trace.statusAt) return;
    trace.status = status;
    if (at) trace.statusAt = at;
    trace.statusSetByClaude = byClaude;
  }

  snapshot(): Record<string, TicketTrace> {
    return Object.fromEntries([...this.#tickets].map(([ticket, trace]) => [ticket, { ...trace }]));
  }
}
