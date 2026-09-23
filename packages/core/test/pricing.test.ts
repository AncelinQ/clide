import { describe, expect, it } from "vitest";

import { calibrate, modelKey, samplesOf, sessionCost, type CostSample } from "../src/cost/pricing.js";

/** Relevés fabriqués à partir d'un tarif connu, pour vérifier qu'on le retrouve. */
function samples(model: string, rates: [number, number, number, number], count: number): CostSample[] {
  return Array.from({ length: count }, (_, index) => {
    const input = 1000 * (index + 1);
    const output = 700 * (index % 3 + 1);
    const cacheRead = 50_000 * (index + 2);
    const cacheCreation = 3000 * ((index * 7) % 5 + 1);
    const costUSD = (input * rates[0] + output * rates[1] + cacheRead * rates[2] + cacheCreation * rates[3]) / 1e6;
    return { model, input, output, cacheRead, cacheCreation, costUSD };
  });
}

describe("calibrate", () => {
  it("retrouve un tarif libre à partir de relevés variés", () => {
    const calibration = calibrate(samples("modele-a", [3, 15, 0.3, 3.75], 8)).get("modele-a");
    expect(calibration?.method).toBe("libre");
    expect(calibration?.rates.output).toBeCloseTo(15e-6, 10);
    expect(calibration?.rates.cacheCreation).toBeCloseTo(3.75e-6, 10);
  });

  it("se contente d'un tarif de base quand les proportions habituelles tiennent", () => {
    const calibration = calibrate(samples("modele-b", [1, 5, 0.1, 2], 3)).get("modele-b");
    expect(calibration?.method).toBe("proportions");
    expect(calibration?.rates.input).toBeCloseTo(1e-6, 10);
  });

  it("ne donne pas de tarif à un modèle qu'aucun ajustement ne décrit", () => {
    // Proportions inhabituelles et trop peu de relevés pour l'ajustement libre.
    expect(calibrate(samples("modele-c", [2, 20, 0.2, 8], 4)).has("modele-c")).toBe(false);
  });

  it("ne tire rien de moins de trois relevés", () => {
    expect(calibrate(samples("modele-d", [1, 5, 0.1, 2], 2)).size).toBe(0);
  });
});

describe("sessionCost", () => {
  const calibration = calibrate(samples("claude-haiku", [1, 5, 0.1, 2], 4));
  const tokens = { input: 1_000_000, output: 0, cacheRead: 0, cacheCreation: 0 };

  it("rend le relevé tel quel quand rien ne l'a suivi", () => {
    expect(sessionCost({ cost: { totalCostUSD: 2.5 }, usage: { "claude-haiku": tokens } }, calibration)).toEqual({
      kind: "exact",
      usd: 2.5,
    });
  });

  it("ajoute l'estimation de ce qui a suivi le relevé", () => {
    const cost = sessionCost({ cost: { totalCostUSD: 2.5 }, afterCost: { "claude-haiku": tokens } }, calibration);
    expect(cost.kind).toBe("estimated");
    expect(cost.kind === "estimated" && cost.usd).toBeCloseTo(3.5, 6);
  });

  it("donne un plancher quand une partie n'a pas de tarif", () => {
    const cost = sessionCost({ cost: { totalCostUSD: 2.5 }, afterCost: { "claude-opus-9": tokens } }, calibration);
    expect(cost).toEqual({ kind: "atLeast", usd: 2.5, unpriced: ["claude-opus-9"] });
  });

  it("n'invente rien pour une session sans relevé ni tarif", () => {
    expect(sessionCost({ usage: { "claude-opus-9[1m]": tokens } }, calibration)).toEqual({
      kind: "unknown",
      unpriced: ["claude-opus-9"],
    });
  });
});

describe("relevés et modèles", () => {
  it("confond les variantes entre crochets d'un même modèle", () => {
    expect(modelKey("claude-opus-5[1m]")).toBe("claude-opus-5");
    expect(modelKey("claude-opus-5")).toBe("claude-opus-5");
  });

  it("lit les relevés d'un cost-state, un par modèle payant", () => {
    const list = samplesOf({
      totalCostUSD: 1,
      modelUsage: {
        "claude-opus-5[1m]": { inputTokens: 2, outputTokens: 3, cacheReadInputTokens: 4, cacheCreationInputTokens: 5, costUSD: 0.9 },
        gratuit: { inputTokens: 1, costUSD: 0 },
      },
    });
    expect(list).toEqual([{ model: "claude-opus-5", input: 2, output: 3, cacheRead: 4, cacheCreation: 5, costUSD: 0.9 }]);
  });
});
