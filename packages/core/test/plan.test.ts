import { describe, expect, it } from "vitest";

import { extractPlan, planProgress } from "../src/session/plan.js";
import type { TranscriptEvent } from "../src/transcript/events.js";

const exitPlan = (plan: string, timestamp?: string): TranscriptEvent => ({
  type: "assistant",
  ...(timestamp ? { timestamp } : {}),
  message: {
    role: "assistant",
    content: [{ type: "tool_use", id: "t1", name: "ExitPlanMode", input: { plan } }],
  },
});

describe("planProgress", () => {
  it("compte les cases cochées et le total", () => {
    expect(planProgress("- [x] fait\n- [ ] à faire\n* [X] fait aussi\n")).toEqual({ done: 2, total: 3 });
  });

  it("ignore des crochets au fil du texte", () => {
    // « [x] » au milieu d'une phrase n'est pas une tâche ; le compter gonflerait
    // la progression affichée.
    expect(planProgress("On garde le cas [x] pour plus tard.")).toBeUndefined();
  });

  it("ne rend rien pour un plan sans cases", () => {
    expect(planProgress("1. première étape\n2. seconde étape")).toBeUndefined();
  });
});

describe("extractPlan", () => {
  it("prend le plan dans l'appel à ExitPlanMode", () => {
    const { plan } = extractPlan([
      { type: "user" },
      exitPlan("## Plan\n- [ ] écrire le lecteur\n- [x] poser les fixtures\n", "2026-09-22T10:00:00.000Z"),
    ]);

    expect(plan?.text).toContain("écrire le lecteur");
    expect(plan?.at).toBe("2026-09-22T10:00:00.000Z");
    expect(plan?.progress).toEqual({ done: 1, total: 2 });
  });

  it("garde le dernier plan quand la session en propose plusieurs", () => {
    const { plan } = extractPlan([exitPlan("premier plan"), exitPlan("plan révisé")]);
    expect(plan?.text).toBe("plan révisé");
  });

  it("distingue « pas de plan » de « jamais passé en mode plan »", () => {
    // `mode: normal` accompagne chaque tour sans rien dire des permissions.
    const sansPlan = extractPlan([{ type: "mode", mode: "normal" }, { type: "permission-mode", permissionMode: "auto" }]);
    expect(sansPlan.plan).toBeUndefined();
    expect(sansPlan.mode).toBe("auto");
    expect(sansPlan.planModeEntries).toBe(0);

    const enPlan = extractPlan([
      { type: "permission-mode", permissionMode: "plan" },
      { type: "mode", mode: "normal" },
      { type: "permission-mode", permissionMode: "auto" },
    ]);
    expect(enPlan.planModeEntries).toBe(1);
    expect(enPlan.mode).toBe("auto");
  });

  it("ignore un appel sans texte de plan", () => {
    const { plan } = extractPlan([
      {
        type: "assistant",
        message: { role: "assistant", content: [{ type: "tool_use", name: "ExitPlanMode", input: {} }] },
      },
    ]);
    expect(plan).toBeUndefined();
  });

  it("ne confond pas un autre outil avec une sortie de mode plan", () => {
    const { plan } = extractPlan([
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: "Write", input: { plan: "piège" } }],
        },
      },
    ]);
    expect(plan).toBeUndefined();
  });

  it("traverse un flux sans message sans lever", () => {
    expect(() => extractPlan([{ type: "assistant" }, { type: "system" }])).not.toThrow();
  });
});

describe("extractPlan sur le format vivant", () => {
  it("compte l'entrée en mode plan portée par le prompt, une fois par passage", () => {
    const lookup = extractPlan([
      { type: "permission-mode", permissionMode: "auto" },
      { type: "user", permissionMode: "plan" },
      { type: "attachment", attachment: { type: "plan_mode", planFilePath: "C:/x/.claude/plans/a.md" } },
      { type: "mode", mode: "normal" },
      { type: "user", permissionMode: "plan" },
      { type: "user", permissionMode: "auto" },
    ]);
    expect(lookup.planModeEntries).toBe(1);
    expect(lookup.mode).toBe("auto");
    expect(lookup.planFilePath).toBe("C:/x/.claude/plans/a.md");
  });
});
