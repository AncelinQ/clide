import { describe, expect, it } from "vitest";

import { findDecorations, findStatus, rgbOf } from "../src/lib/terminal-find";

describe("rgbOf", () => {
  it("lit les deux formes qu'un canevas rend", () => {
    expect(rgbOf("#16161a")).toEqual([0x16, 0x16, 0x1a]);
    expect(rgbOf("rgba(10, 20, 30, 0.5)")).toEqual([10, 20, 30]);
    expect(rgbOf("rgb(255,0,128)")).toEqual([255, 0, 128]);
  });

  it("ne devine pas une couleur qu'il ne sait pas lire", () => {
    expect(rgbOf("")).toBeUndefined();
    expect(rgbOf("oklch(0.7 0.1 250)")).toBeUndefined();
  });
});

describe("findDecorations", () => {
  it("fond l'accent dans le fond du terminal, plus franc et cerné pour le résultat courant", () => {
    const decorations = findDecorations("#ff0000", "#000000");
    expect(decorations.matchOverviewRuler).toBe("#ff0000");
    expect(decorations.activeMatchColorOverviewRuler).toBe("#ff0000");
    expect(decorations.activeMatchBorder).toBe("#ff0000");
    expect(decorations.activeMatchBackground).toBe("#a60000");
    expect(decorations.matchBackground).toBe("#4d0000");
  });

  it("rend toujours du #rrggbb, seul format que prennent les surlignages d'xterm", () => {
    const decorations = findDecorations("pas une couleur", "");
    for (const color of Object.values(decorations)) expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("findStatus", () => {
  it("ne dit rien tant qu'il n'y a pas de recherche", () => {
    expect(findStatus(undefined).text).toBe("");
  });

  it("compte le résultat courant à partir de 1", () => {
    expect(findStatus({ index: 2, count: 12 })).toEqual({ text: "{index} sur {count}", values: { index: 3, count: 12 } });
  });

  it("dit l'absence de résultat, le plafond dépassé et l'expression invalide", () => {
    expect(findStatus({ index: -1, count: 0 }).text).toBe("Aucun résultat");
    expect(findStatus({ index: -1, count: 1000 })).toEqual({ text: "Plus de {count}", values: { count: 1000 } });
    expect(findStatus({ invalid: true }).text).toBe("Expression invalide");
  });
});
