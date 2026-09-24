import { describe, expect, it } from "vitest";

import { commitInstructions, mrInstructions, unfence } from "../src/session/writeup.js";

describe("commitInstructions", () => {
  it("donne les derniers sujets du dépôt comme convention à suivre", () => {
    const text = commitInstructions(["feat(ui): a", "fix(api): b"]);
    expect(text).toContain("- feat(ui): a\n- fix(api): b");
    expect(text).toContain("follow their convention");
  });

  it("retombe sur Conventional Commits sans historique", () => {
    expect(commitInstructions([])).toContain("Conventional Commits");
  });
});

describe("mrInstructions", () => {
  it("rédige dans la langue de l'interface", () => {
    expect(mrInstructions("fr")).toContain("## Comment tester");
    expect(mrInstructions("en")).toContain("## How to test");
  });
});

describe("unfence", () => {
  it("retire un bloc de code qui enveloppe toute la réponse", () => {
    expect(unfence("```text\nfeat: x\n\nbody\n```")).toBe("feat: x\n\nbody");
  });

  it("garde un bloc de code au milieu du texte", () => {
    const answer = "# Titre\n\n```bash\npnpm test\n```\n\nfin";
    expect(unfence(answer)).toBe(answer);
  });
});
