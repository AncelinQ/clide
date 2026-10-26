import { describe, expect, it } from "vitest";

import { anchorOf, placeTip, type TipSide } from "../src/lib/tooltip";

const viewport = { width: 1000, height: 600 };

/** Une infobulle de 100 × 20 pour un élément de 24 × 24 posé en (`left`, `top`). */
function place(left: number, top: number, side: TipSide = "below") {
  return placeTip({ rect: { left, top, width: 24, height: 24 }, width: 100, height: 20, side, viewport });
}

describe("placeTip", () => {
  it("centre l'infobulle sous son élément", () => {
    expect(place(400, 100)).toEqual({ left: 362, top: 130 });
  });

  it("la passe au-dessus quand elle dépasserait en bas", () => {
    expect(place(400, 560)).toEqual({ left: 362, top: 534 });
  });

  it("la pose à côté, centrée sur la hauteur de l'élément", () => {
    expect(place(400, 100, "right")).toEqual({ left: 430, top: 102 });
    expect(place(400, 100, "left")).toEqual({ left: 294, top: 102 });
  });

  it("change de côté quand elle dépasserait", () => {
    expect(place(950, 100, "right")).toEqual({ left: 844, top: 102 });
    expect(place(10, 100, "left")).toEqual({ left: 40, top: 102 });
  });

  it("la garde dans la fenêtre sur chaque bord", () => {
    expect(place(0, 100).left).toBe(4);
    expect(place(990, 100).left).toBe(896);
    expect(place(400, 0, "right").top).toBe(4);
    expect(place(400, 590, "right").top).toBe(576);
  });

  it("colle au bord gauche une infobulle plus large que la fenêtre", () => {
    const wide = placeTip({ rect: { left: 400, top: 100, width: 24, height: 24 }, width: 1200, height: 20, side: "below", viewport });
    expect(wide.left).toBe(4);
  });
});

describe("anchorOf", () => {
  const pointer = { x: 500, y: 300 };

  it("garde l'élément comme repère quand il est petit, ou sans pointeur", () => {
    const button = { left: 400, top: 100, width: 24, height: 24 };
    expect(anchorOf(button, pointer)).toEqual(button);
    const splitter = { left: 334, top: 41, width: 4, height: 600 };
    expect(anchorOf(splitter)).toEqual(splitter);
  });

  it("prend le pointeur dans le sens où l'élément est trop grand", () => {
    expect(anchorOf({ left: 334, top: 41, width: 4, height: 600 }, pointer)).toEqual({ left: 334, width: 4, top: 284, height: 32 });
    expect(anchorOf({ left: 40, top: 280, width: 280, height: 40 }, pointer)).toEqual({ left: 484, width: 32, top: 280, height: 40 });
  });
});
