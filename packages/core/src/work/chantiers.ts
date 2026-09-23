import type { IndexedSession } from "../session/session-index.js";
import type { PrLink } from "../transcript/events.js";
import { ticketOfBranch } from "./tickets.js";

/**
 * Lien d'une session à son chantier.
 *
 * - `travaillée` : sa branche porte le ticket, ou elle est la branche du chantier.
 * - `consultée` : Claude y a lu ou modifié le ticket, depuis une autre branche.
 */
export type ChantierRelation = "travaillée" | "consultée";

export interface ChantierSession {
  sessionId: string;
  relation: ChantierRelation;
  title?: string;
  gitBranch?: string;
  cwd?: string;
  lastActivityAt?: string;
}

export interface Chantier {
  /** Identifiant du ticket, ou nom de la branche pour un chantier sans ticket. */
  key: string;
  kind: "ticket" | "branche";
  title?: string;
  url?: string;
  /** Dernier état connu du ticket, avec sa date et la session qui l'a vu. */
  status?: string;
  statusAt?: string;
  statusSetByClaude?: boolean;
  statusSessionId?: string;
  branches: string[];
  worktrees: string[];
  mrs: PrLink[];
  sessions: ChantierSession[];
  lastActivityAt?: string;
}

/** Branches qui ne sont le chantier de personne. */
const TRUNKS = new Set(["main", "master", "develop", "dev", "HEAD"]);

/**
 * Chantiers : ce qui a été fait pour chaque ticket, et pour chaque branche qui
 * n'en porte pas.
 *
 * Tout vient des transcripts. Le ticket d'une session se lit dans le nom de sa
 * branche et dans les appels aux outils Linear ; son état est le dernier que
 * Claude a lu ou fixé, daté — pas l'état du moment, que seul Linear connaît. Les
 * MR sont celles qu'ont ouvertes les sessions travaillées : une session qui ne fait
 * que consulter le ticket peut en avoir ouvert d'autres, sans rapport.
 */
export function buildChantiers(sessions: IndexedSession[]): Chantier[] {
  const chantiers = new Map<string, Chantier>();
  const get = (key: string, kind: Chantier["kind"]): Chantier => {
    let chantier = chantiers.get(key);
    if (!chantier) {
      chantier = { key, kind, branches: [], worktrees: [], mrs: [], sessions: [] };
      chantiers.set(key, chantier);
    }
    return chantier;
  };
  const addSession = (chantier: Chantier, session: IndexedSession, relation: ChantierRelation) => {
    const existing = chantier.sessions.find((entry) => entry.sessionId === session.sessionId);
    if (existing) {
      if (relation === "travaillée") existing.relation = relation;
      return;
    }
    chantier.sessions.push({
      sessionId: session.sessionId,
      relation,
      ...(session.title ? { title: session.title } : {}),
      ...(session.gitBranch ? { gitBranch: session.gitBranch } : {}),
      ...(session.effectiveCwd ? { cwd: session.effectiveCwd } : {}),
      ...(session.lastActivityAt ? { lastActivityAt: session.lastActivityAt } : {}),
    });
    if (session.lastActivityAt && (!chantier.lastActivityAt || session.lastActivityAt > chantier.lastActivityAt)) {
      chantier.lastActivityAt = session.lastActivityAt;
    }
  };
  const worked = (chantier: Chantier, session: IndexedSession) => {
    addSession(chantier, session, "travaillée");
    if (session.gitBranch && !chantier.branches.includes(session.gitBranch)) chantier.branches.push(session.gitBranch);
    if (session.worktreePath && !chantier.worktrees.includes(session.worktreePath)) {
      chantier.worktrees.push(session.worktreePath);
    }
    for (const link of session.prLinks) {
      if (link.prUrl && !chantier.mrs.some((known) => known.prUrl === link.prUrl)) chantier.mrs.push(link);
    }
  };

  for (const session of sessions) {
    const branch = session.gitBranch;
    const ticket = ticketOfBranch(branch);
    if (ticket) worked(get(ticket, "ticket"), session);
    else if (branch && !TRUNKS.has(branch)) worked(get(branch, "branche"), session);

    for (const [key, trace] of Object.entries(session.tickets ?? {})) {
      const chantier = get(key, "ticket");
      addSession(chantier, session, key === ticket ? "travaillée" : "consultée");
      if (trace.title) chantier.title = trace.title;
      if (trace.url) chantier.url = trace.url;
      if (trace.status && (!chantier.statusAt || (trace.statusAt ?? "") >= chantier.statusAt)) {
        chantier.status = trace.status;
        if (trace.statusAt) chantier.statusAt = trace.statusAt;
        chantier.statusSetByClaude = trace.statusSetByClaude ?? false;
        chantier.statusSessionId = session.sessionId;
      }
    }
  }

  for (const chantier of chantiers.values()) {
    chantier.sessions.sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""));
  }
  return [...chantiers.values()].sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""));
}
