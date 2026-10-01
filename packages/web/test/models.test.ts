import { describe, expect, it } from "vitest";

import { findModel, type ModelChoice } from "../src/lib/models";

const model = (id: string, name: string, main = true): ModelChoice => ({ id, name, main });
const CATALOG = [
  model("claude-opus-5-5", "Opus 5.5"),
  model("claude-fable-5-1", "Fable 5.1"),
  model("claude-haiku-4-5-20251001", "Haiku 4.5"),
  model("claude-opus-5", "Opus 5", false),
];
const ALIASES = [model("opus", "Opus"), model("haiku", "Haiku")];

describe("findModel", () => {
  it("reconnaît un identifiant, avec ou sans date ni suffixe de contexte", () => {
    expect(findModel(CATALOG, "claude-opus-5-5")?.name).toBe("Opus 5.5");
    expect(findModel(CATALOG, "claude-haiku-4-5")?.name).toBe("Haiku 4.5");
    expect(findModel(CATALOG, "claude-opus-5[1m]")?.name).toBe("Opus 5");
  });

  it("ne confond pas un modèle avec un autre dont l'identifiant le prolonge", () => {
    expect(findModel(CATALOG, "claude-opus-5")?.name).toBe("Opus 5");
    expect(findModel(CATALOG, "claude-opus-4-1")).toBeUndefined();
  });

  it("reconnaît le nom qu'affiche le sélecteur de /model", () => {
    expect(findModel(CATALOG, "Fable 5.1")?.id).toBe("claude-fable-5-1");
    expect(findModel(CATALOG, "Opus 5 (1M context) (default)")?.id).toBe("claude-opus-5");
  });

  it("rapproche un alias de famille et un identifiant complet", () => {
    expect(findModel(CATALOG, "opus")?.id).toBe("claude-opus-5-5");
    expect(findModel(ALIASES, "claude-haiku-4-5-20251001")?.id).toBe("haiku");
    expect(findModel(CATALOG, undefined)).toBeUndefined();
  });
});
