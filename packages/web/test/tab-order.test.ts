import { describe, expect, it } from "vitest";

import { dropTab, moveTab, orderTabs, shiftTab } from "../src/lib/tab-order";

describe("orderTabs", () => {
  it("garde l'ordre rangé, ajoute les nouveaux à la fin et oublie les disparus", () => {
    expect(orderTabs(["b", "gone", "a"], ["a", "b", "c", "d"])).toEqual(["b", "a", "c", "d"]);
  });

  it("rend l'ordre d'ouverture sans ordre rangé", () => {
    expect(orderTabs([], ["t1", "C:\p\a.ts"])).toEqual(["t1", "C:\p\a.ts"]);
  });
});

describe("moveTab", () => {
  it("place un onglet devant un autre, en tête ou en fin", () => {
    expect(moveTab(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(moveTab(["a", "b", "c"], "a", "c")).toEqual(["b", "a", "c"]);
    expect(moveTab(["a", "b", "c"], "a", null)).toEqual(["b", "c", "a"]);
    expect(moveTab(["a", "b", "c"], "b", "b")).toEqual(["a", "b", "c"]);
  });
});

describe("shiftTab", () => {
  it("décale d'un cran, sans faire le tour", () => {
    expect(shiftTab(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(shiftTab(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
    expect(shiftTab(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
    expect(shiftTab(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
  });
});

describe("dropTab", () => {
  it("place l'onglet lâché avant ou après sa cible", () => {
    expect(dropTab(["a", "b", "c"], "a", "b", "after")).toEqual(["b", "a", "c"]);
    expect(dropTab(["a", "b", "c"], "a", "c", "after")).toEqual(["b", "c", "a"]);
    expect(dropTab(["a", "b", "c"], "c", "a", "before")).toEqual(["c", "a", "b"]);
    expect(dropTab(["a", "b", "c"], "c", "b", "after")).toEqual(["a", "b", "c"]);
  });
});
