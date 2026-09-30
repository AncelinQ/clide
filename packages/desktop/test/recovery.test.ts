import { describe, expect, it } from "vitest";

import { RetryBudget } from "../src/recovery";

describe("RetryBudget", () => {
  it("refuse la relance de trop dans la fenêtre", () => {
    let now = 0;
    const budget = new RetryBudget(3, 60_000, () => now);
    expect([budget.take(), budget.take(), budget.take()]).toEqual([true, true, true]);
    now = 59_999;
    expect(budget.take()).toBe(false);
  });

  it("rend les relances sorties de la fenêtre", () => {
    let now = 0;
    const budget = new RetryBudget(2, 60_000, () => now);
    budget.take();
    now = 30_000;
    budget.take();
    now = 60_000;
    expect(budget.take()).toBe(true);
    expect(budget.take()).toBe(false);
  });

  it("ne compte pas une relance refusée", () => {
    let now = 0;
    const budget = new RetryBudget(1, 60_000, () => now);
    budget.take();
    now = 10_000;
    expect(budget.take()).toBe(false);
    now = 60_000;
    expect(budget.take()).toBe(true);
  });
});
