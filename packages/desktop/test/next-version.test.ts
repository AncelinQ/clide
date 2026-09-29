import { describe, expect, it } from "vitest";

import { nextVersion } from "../scripts/next-version.mjs";

describe("nextVersion", () => {
  it("reprend la version de package.json tant qu'aucune release n'existe", () => {
    expect(nextVersion([], "0.1.0")).toBe("0.1.0");
  });

  it("monte le patch du dernier tag", () => {
    expect(nextVersion(["v0.1.0", "v0.1.2", "v0.1.1"], "0.1.0")).toBe("0.1.3");
  });

  it("compare les versions en nombres, pas en texte", () => {
    expect(nextVersion(["v0.1.9", "v0.1.10"], "0.1.0")).toBe("0.1.11");
  });

  it("suit package.json quand il annonce une version plus haute", () => {
    expect(nextVersion(["v0.1.4"], "0.2.0")).toBe("0.2.0");
  });

  it("ignore les tags qui ne sont pas des versions", () => {
    expect(nextVersion(["v0.1.1", "v1.0.0-beta", "latest"], "0.1.0")).toBe("0.1.2");
  });

  it("refuse une version de package.json illisible", () => {
    expect(() => nextVersion([], "1.0")).toThrow(/invalide/);
  });
});
