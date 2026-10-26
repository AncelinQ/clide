import { describe, expect, it } from "vitest";

import { barMove, holderOf } from "../src/lib/bar-keys";
import { barEntries, barItems, groupTabId, type TabGroup } from "../src/lib/tab-groups";

const ids = ["a", "b", "c"];

describe("barMove", () => {
  it("passe à la voisine, en bouclant aux deux bouts", () => {
    expect(barMove(ids, "a", "ArrowRight")).toBe("b");
    expect(barMove(ids, "c", "ArrowRight")).toBe("a");
    expect(barMove(ids, "b", "ArrowLeft")).toBe("a");
    expect(barMove(ids, "a", "ArrowLeft")).toBe("c");
  });

  it("va à la première avec Début, à la dernière avec Fin", () => {
    expect(barMove(ids, "b", "Home")).toBe("a");
    expect(barMove(ids, "b", "End")).toBe("c");
  });

  it("repart de la première quand le focus n'est sur aucune entrée", () => {
    expect(barMove(ids, undefined, "ArrowLeft")).toBe("a");
    expect(barMove(ids, "disparu", "ArrowRight")).toBe("a");
  });

  it("ne déplace rien pour une autre touche, ni dans une barre vide", () => {
    expect(barMove(ids, "a", "Enter")).toBeUndefined();
    expect(barMove(ids, "a", "ArrowDown")).toBeUndefined();
    expect(barMove([], undefined, "ArrowRight")).toBeUndefined();
    expect(barMove([], undefined, "End")).toBeUndefined();
  });
});

describe("holderOf", () => {
  const group = (folded: boolean): TabGroup => ({ id: "g", name: "G", color: "blue", folded });
  const entries = (folded: boolean) => barEntries(barItems(["a", "b", "c"], { groups: [group(folded)], members: { b: "g", c: "g" } }));

  it("rend l'onglet lui-même quand il est dans la barre", () => {
    expect(holderOf(entries(false), "a")).toBe("a");
    expect(holderOf(entries(false), "c")).toBe("c");
  });

  it("rend l'étiquette du groupe replié qui cache l'onglet", () => {
    expect(holderOf(entries(true), "b")).toBe(groupTabId("g"));
  });

  it("ne rend rien pour un onglet absent de la barre, ou sans onglet", () => {
    expect(holderOf(entries(false), "rangé-dans-scripts")).toBeUndefined();
    expect(holderOf(entries(false), null)).toBeUndefined();
  });
});
