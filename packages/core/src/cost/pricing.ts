import type { TokenCounts } from "../session/projection.js";
import type { CostState } from "../transcript/events.js";

/** Tarif d'un modèle, en dollars par token, pour chaque nature de token. */
export interface Rates {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

export interface Calibration {
  rates: Rates;
  /** Relevés sur lesquels le tarif a été vérifié. */
  samples: number;
  /** Plus grand écart relatif entre le coût relevé et celui qu'on recalcule. */
  maxError: number;
  method: "libre" | "proportions";
}

/** Un relevé de Claude Code : les volumes d'un modèle et ce qu'ils ont coûté. */
export interface CostSample extends TokenCounts {
  model: string;
  costUSD: number;
}

/** Au-delà, un tarif déduit ne décrit pas les relevés : on ne s'en sert pas. */
const TOLERANCE = 0.02;
const MIN_SAMPLES = 3;
/** En deçà, un relevé est trop petit pour que son écart relatif veuille dire quelque chose. */
const MIN_COST = 0.01;

/**
 * Nom d'un modèle, sans ses variantes entre crochets.
 *
 * `cost-state` écrit `claude-opus-5[1m]` là où les réponses écrivent
 * `claude-opus-5` ; les relevés montrent le même tarif pour les deux.
 */
export function modelKey(model: string): string {
  return model.replace(/\[[^\]]*\]$/, "");
}

/** Relevés portés par le `cost-state` d'une session, un par modèle. */
export function samplesOf(cost: CostState | undefined): CostSample[] {
  const usage = cost?.modelUsage;
  if (!usage) return [];
  const out: CostSample[] = [];
  for (const [model, value] of Object.entries(usage)) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const count = (key: string): number => (typeof record[key] === "number" ? (record[key] as number) : 0);
    const costUSD = count("costUSD");
    if (costUSD <= 0) continue;
    out.push({
      model: modelKey(model),
      input: count("inputTokens"),
      output: count("outputTokens"),
      cacheRead: count("cacheReadInputTokens"),
      cacheCreation: count("cacheCreationInputTokens"),
      costUSD,
    });
  }
  return out;
}

const vector = (counts: TokenCounts): number[] => [counts.input, counts.output, counts.cacheRead, counts.cacheCreation];

export function priceOf(counts: TokenCounts, rates: Rates): number {
  return (
    counts.input * rates.input +
    counts.output * rates.output +
    counts.cacheRead * rates.cacheRead +
    counts.cacheCreation * rates.cacheCreation
  );
}

/** Moindres carrés par équations normales ; rien si le système est dégénéré. */
function leastSquares(rows: number[][], targets: number[]): number[] | undefined {
  const n = rows[0]?.length ?? 0;
  const a = Array.from({ length: n }, () => Array<number>(n).fill(0));
  const b = Array<number>(n).fill(0);
  rows.forEach((row, index) => {
    for (let i = 0; i < n; i++) {
      b[i]! += row[i]! * targets[index]!;
      for (let j = 0; j < n; j++) a[i]![j]! += row[i]! * row[j]!;
    }
  });
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(a[r]![i]!) > Math.abs(a[pivot]![i]!)) pivot = r;
    [a[i], a[pivot]] = [a[pivot]!, a[i]!];
    [b[i], b[pivot]] = [b[pivot]!, b[i]!];
    if (Math.abs(a[i]![i]!) < 1e-12) return undefined;
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const factor = a[r]![i]! / a[i]![i]!;
      for (let k = i; k < n; k++) a[r]![k]! -= factor * a[i]![k]!;
      b[r]! -= factor * b[i]!;
    }
  }
  return b.map((value, i) => value / a[i]![i]!);
}

function worstError(samples: CostSample[], rates: Rates): number {
  const checked = samples.filter((sample) => sample.costUSD >= MIN_COST);
  if (checked.length === 0) return Number.POSITIVE_INFINITY;
  return Math.max(...checked.map((sample) => Math.abs(priceOf(sample, rates) - sample.costUSD) / sample.costUSD));
}

/**
 * Tarif d'un modèle, déduit des coûts que Claude Code a lui-même calculés.
 *
 * Aucun prix n'est écrit en dur : il changerait avec les modèles et se
 * tromperait sans prévenir. Deux ajustements sont tentés, du plus contraint au
 * plus libre. Le contraint garde les proportions habituelles — sortie cinq fois
 * l'entrée, lecture de cache au dixième, écriture de cache au double — et ne
 * cherche qu'un tarif de base. Le libre cherche un tarif par nature de token, et
 * demande assez de relevés variés.
 *
 * Un tarif n'est retenu que s'il redonne chaque relevé à 2 % près, sur au moins
 * trois relevés : un modèle dont la tarification est structurée autrement n'en
 * reçoit pas plutôt que d'en recevoir un faux.
 */
export function calibrate(samples: CostSample[]): Map<string, Calibration> {
  const byModel = new Map<string, CostSample[]>();
  for (const sample of samples) byModel.set(sample.model, [...(byModel.get(sample.model) ?? []), sample]);

  const out = new Map<string, Calibration>();
  for (const [model, list] of byModel) {
    if (list.length < MIN_SAMPLES) continue;

    // Le plus contraint d'abord : quand les proportions habituelles décrivent
    // les relevés, un seul tarif de base tient mieux qu'un ajustement libre, qui
    // épouse le bruit des relevés.
    const units = (sample: CostSample) =>
      sample.input + 5 * sample.output + 0.1 * sample.cacheRead + 2 * sample.cacheCreation;
    const base = list.reduce((sum, sample) => sum + sample.costUSD, 0) / list.reduce((sum, sample) => sum + units(sample), 0);
    const proportional = { input: base, output: 5 * base, cacheRead: 0.1 * base, cacheCreation: 2 * base };
    const proportionalError = worstError(list, proportional);
    if (proportionalError <= TOLERANCE) {
      out.set(model, { rates: proportional, samples: list.length, maxError: proportionalError, method: "proportions" });
      continue;
    }

    const free = list.length >= 6 ? leastSquares(list.map(vector), list.map((sample) => sample.costUSD)) : undefined;
    if (free && free.every((rate) => rate >= 0)) {
      const rates = { input: free[0]!, output: free[1]!, cacheRead: free[2]!, cacheCreation: free[3]! };
      const error = worstError(list, rates);
      if (error <= TOLERANCE) out.set(model, { rates, samples: list.length, maxError: error, method: "libre" });
    }
  }
  return out;
}

/**
 * Coût d'une session.
 *
 * - `exact` : le relevé de Claude Code, rien n'ayant suivi.
 * - `estimated` : un tarif déduit a servi, pour toute la session ou pour ce qui a
 *   suivi son dernier relevé.
 * - `atLeast` : une partie relève d'un modèle sans tarif fiable ; le montant est
 *   un plancher.
 * - `unknown` : rien de chiffrable.
 */
export type SessionCost =
  | { kind: "exact"; usd: number }
  | { kind: "estimated"; usd: number }
  | { kind: "atLeast"; usd: number; unpriced: string[] }
  | { kind: "unknown"; unpriced: string[] };

export function sessionCost(
  input: {
    cost?: CostState | undefined;
    /** Tokens de la session et de ses sous-agents, par modèle. */
    usage?: Record<string, TokenCounts> | undefined;
    /** Tokens écrits après le dernier relevé, sous-agents compris. */
    afterCost?: Record<string, TokenCounts> | undefined;
  },
  calibration: Map<string, Calibration>,
): SessionCost {
  const recorded = input.cost?.totalCostUSD;
  const toPrice = recorded !== undefined ? input.afterCost : input.usage;

  let estimate = 0;
  const unpriced: string[] = [];
  for (const [model, counts] of Object.entries(toPrice ?? {})) {
    const volume = counts.input + counts.output + counts.cacheRead + counts.cacheCreation;
    if (volume === 0) continue;
    const known = calibration.get(modelKey(model));
    if (known) estimate += priceOf(counts, known.rates);
    else unpriced.push(modelKey(model));
  }
  const base = recorded ?? 0;
  const hasEstimate = Object.keys(toPrice ?? {}).length > 0;

  if (unpriced.length > 0) {
    return base + estimate > 0
      ? { kind: "atLeast", usd: base + estimate, unpriced: [...new Set(unpriced)] }
      : { kind: "unknown", unpriced: [...new Set(unpriced)] };
  }
  if (recorded !== undefined && !hasEstimate) return { kind: "exact", usd: recorded };
  if (recorded === undefined && !hasEstimate) return { kind: "unknown", unpriced: [] };
  return { kind: "estimated", usd: base + estimate };
}

/** Additionne des volumes par modèle. */
export function mergeUsage(...parts: (Record<string, TokenCounts> | undefined)[]): Record<string, TokenCounts> {
  const out: Record<string, TokenCounts> = {};
  for (const part of parts) {
    for (const [model, counts] of Object.entries(part ?? {})) {
      const slot = (out[model] ??= { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 });
      slot.input += counts.input;
      slot.output += counts.output;
      slot.cacheRead += counts.cacheRead;
      slot.cacheCreation += counts.cacheCreation;
    }
  }
  return out;
}
