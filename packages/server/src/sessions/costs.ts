import {
  calibrate,
  mergeUsage,
  modelKey,
  priceOf,
  samplesOf,
  sessionCost,
  type Calibration,
  type IndexedSession,
  type SessionCost,
  type SessionIndex,
  type TokenCounts,
} from "@claude-ide/core";

/** Tarifs déduits des relevés de l'index, recalculés à chaque lecture. */
export function calibrationOf(index: SessionIndex): Map<string, Calibration> {
  return calibrate(index.list({ kind: "session" }).flatMap((session) => samplesOf(session.cost)));
}

/**
 * Coût d'une session de l'index, sous-agents compris.
 *
 * Le relevé de Claude Code couvre déjà ses sous-agents : il n'est complété que par
 * ce que la session elle-même a écrit après lui. Sans relevé, les tokens des
 * sous-agents s'ajoutent aux siens.
 */
export function costOfSession(
  session: IndexedSession,
  index: SessionIndex,
  calibration: Map<string, Calibration>,
): SessionCost {
  const subagents = index.subagents(session.sessionId);
  return sessionCost(
    {
      cost: session.cost,
      usage: mergeUsage(session.usage, ...subagents.map((subagent) => subagent.usage)),
      afterCost: session.usageAfterCost,
    },
    calibration,
  );
}

/** Coût par modèle d'une session : le détail du relevé, sinon l'estimation. */
function costByModel(
  session: IndexedSession,
  index: SessionIndex,
  calibration: Map<string, Calibration>,
): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (model: string, usd: number) => {
    out[modelKey(model)] = (out[modelKey(model)] ?? 0) + usd;
  };
  if (session.cost?.totalCostUSD !== undefined) {
    for (const sample of samplesOf(session.cost)) add(sample.model, sample.costUSD);
    for (const [model, counts] of Object.entries(session.usageAfterCost ?? {})) {
      const known = calibration.get(modelKey(model));
      if (known) add(model, priceOf(counts, known.rates));
    }
    return out;
  }
  const usage: Record<string, TokenCounts> = mergeUsage(
    session.usage,
    ...index.subagents(session.sessionId).map((subagent) => subagent.usage),
  );
  for (const [model, counts] of Object.entries(usage)) {
    const known = calibration.get(modelKey(model));
    if (known) add(model, priceOf(counts, known.rates));
  }
  return out;
}

export interface CostReport {
  total: { exact: number; estimated: number; atLeast: number };
  sessions: { exact: number; estimated: number; atLeast: number; unknown: number };
  /** Jour de la dernière activité de chaque session, au format `AAAA-MM-JJ`. */
  byDay: { day: string; usd: number }[];
  byProject: { project: string; usd: number; sessions: number }[];
  byModel: { model: string; usd: number }[];
  /** Modèles sans tarif fiable : leur consommation n'est pas chiffrée. */
  unpriced: string[];
  calibration: { model: string; inputPerMillion: number; samples: number; method: string }[];
}

/**
 * Consommation de toutes les sessions, par jour, par projet et par modèle.
 *
 * Une session est rangée au jour de sa dernière activité : ses réponses ne sont
 * pas datées une à une dans l'index, et une session qui court sur deux jours
 * compte pour le second.
 */
export function costReport(index: SessionIndex): CostReport {
  const calibration = calibrationOf(index);
  const report: CostReport = {
    total: { exact: 0, estimated: 0, atLeast: 0 },
    sessions: { exact: 0, estimated: 0, atLeast: 0, unknown: 0 },
    byDay: [],
    byProject: [],
    byModel: [],
    unpriced: [],
    calibration: [...calibration].map(([model, entry]) => ({
      model,
      inputPerMillion: entry.rates.input * 1e6,
      samples: entry.samples,
      method: entry.method,
    })),
  };
  const days = new Map<string, number>();
  const projects = new Map<string, { usd: number; sessions: number }>();
  const models = new Map<string, number>();
  const unpriced = new Set<string>();

  for (const session of index.list({ kind: "session" })) {
    const cost = costOfSession(session, index, calibration);
    report.sessions[cost.kind] += 1;
    if ("unpriced" in cost) for (const model of cost.unpriced) unpriced.add(model);
    if (cost.kind === "unknown") continue;
    report.total[cost.kind] += cost.usd;

    const day = (session.lastActivityAt ?? "").slice(0, 10) || "inconnu";
    days.set(day, (days.get(day) ?? 0) + cost.usd);
    const project = session.effectiveCwd ?? session.projectDir;
    const slot = projects.get(project) ?? { usd: 0, sessions: 0 };
    projects.set(project, { usd: slot.usd + cost.usd, sessions: slot.sessions + 1 });
    for (const [model, usd] of Object.entries(costByModel(session, index, calibration))) {
      models.set(model, (models.get(model) ?? 0) + usd);
    }
  }

  report.byDay = [...days].map(([day, usd]) => ({ day, usd })).sort((a, b) => a.day.localeCompare(b.day));
  report.byProject = [...projects]
    .map(([project, value]) => ({ project, ...value }))
    .sort((a, b) => b.usd - a.usd);
  report.byModel = [...models].map(([model, usd]) => ({ model, usd })).sort((a, b) => b.usd - a.usd);
  report.unpriced = [...unpriced];
  return report;
}
