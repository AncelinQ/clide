import { describe, expect, it } from "vitest";

import { branchPrefixes, pushRecent, roleSuggestions } from "../src/lib/suggestions";

describe("suggestions", () => {
  it("propose les préfixes de branche portés par au moins deux branches, les plus courants d'abord", () => {
    const branches = ["main", "aqn/feat/a", "aqn/feat/b", "aqn/feat/c", "aqn/fix/x", "origin/aqn/fix/y", "release/1"];
    expect(branchPrefixes(branches)).toEqual(["aqn/feat/", "aqn/fix/"]);
  });

  it("propose les rôles des autres liens avant les usuels, sans doublon ni la valeur tapée", () => {
    expect(roleSuggestions(["Paiements", "api", undefined], "front", undefined, 4)).toEqual(["Paiements", "api", "back", "design system"]);
  });

  it("garde les dernières réponses, la plus récente en tête", () => {
    expect(pushRecent(["b", "a"], "a")).toEqual(["a", "b"]);
    expect(pushRecent(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"]);
    expect(pushRecent(["a"], "  ")).toEqual(["a"]);
  });
});
