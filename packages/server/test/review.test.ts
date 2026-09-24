import { describe, expect, it } from "vitest";

import { forgeOf, parseGhPr, parseGlabMr } from "../src/platform/review.js";

describe("forgeOf", () => {
  it("reconnaît la forge à l'adresse du dépôt distant", () => {
    expect(forgeOf("https://github.com/AncelinQ/claude-ide.git")).toBe("github");
    expect(forgeOf("git@gitlab.com:happyneuron/platforms/hn-os-platform.git")).toBe("gitlab");
    expect(forgeOf("https://git.exemple.fr/depot.git")).toBeUndefined();
  });
});

describe("parseGlabMr", () => {
  it("lit la MR et son pipeline", () => {
    const review = parseGlabMr(
      JSON.stringify({
        iid: 196,
        title: "fix(patients): e1 qa",
        state: "opened",
        draft: false,
        web_url: "https://gitlab.com/x/-/merge_requests/196",
        head_pipeline: { status: "running", web_url: "https://gitlab.com/x/-/pipelines/1" },
      }),
    );
    expect(review).toEqual({
      forge: "gitlab",
      number: 196,
      title: "fix(patients): e1 qa",
      state: "open",
      url: "https://gitlab.com/x/-/merge_requests/196",
      ci: "running",
      ciUrl: "https://gitlab.com/x/-/pipelines/1",
    });
  });

  it("distingue un brouillon, une MR fusionnée, et l'absence de pipeline", () => {
    expect(parseGlabMr(JSON.stringify({ iid: 1, state: "opened", draft: true, head_pipeline: null }))).toMatchObject({
      state: "draft",
    });
    const merged = parseGlabMr(JSON.stringify({ iid: 2, state: "merged" }));
    expect(merged.state).toBe("merged");
    expect(merged).not.toHaveProperty("ci");
  });
});

describe("parseGhPr", () => {
  const pr = (checks: unknown[], extra: Record<string, unknown> = {}) =>
    parseGhPr(JSON.stringify({ number: 12, title: "feat", state: "OPEN", isDraft: false, url: "u", statusCheckRollup: checks, ...extra }));

  it("fait d'un échec l'état de toute la CI", () => {
    expect(
      pr([
        { __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" },
        { __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE" },
        { __typename: "CheckRun", status: "IN_PROGRESS", conclusion: "" },
      ]).ci,
    ).toBe("failed");
  });

  it("dit ce qui tourne encore, et tout vert seulement quand tout l'est", () => {
    expect(pr([{ status: "COMPLETED", conclusion: "SUCCESS" }, { status: "IN_PROGRESS" }]).ci).toBe("running");
    expect(pr([{ status: "COMPLETED", conclusion: "SUCCESS" }, { __typename: "StatusContext", state: "SUCCESS" }]).ci).toBe(
      "success",
    );
    expect(pr([])).not.toHaveProperty("ci");
  });

  it("lit l'état et la décision des relecteurs", () => {
    expect(pr([], { reviewDecision: "APPROVED" })).toMatchObject({ state: "open", review: "approved" });
    expect(pr([], { isDraft: true })).toMatchObject({ state: "draft" });
    expect(pr([], { state: "MERGED" })).toMatchObject({ state: "merged" });
  });
});
