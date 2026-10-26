import { describe, expect, it } from "vitest";

import { aimFor, dropTab, moveTab, orderTabs, shiftTab } from "../src/lib/tab-order";

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

describe("aimFor", () => {
  const shown = ["a", "b", "c", "d"];

  it("dépasse une cible plus loin atteinte en avançant, et une plus tôt atteinte en reculant", () => {
    expect(aimFor(shown, "b", "c", 1)).toBe("after");
    expect(aimFor(shown, "b", "d", 1)).toBe("after");
    expect(aimFor(shown, "c", "a", -1)).toBe("before");
  });

  it("ne vise rien à contresens ni pointeur immobile : un élément venu sous le pointeur ne s'échange pas en retour", () => {
    expect(aimFor(shown, "b", "c", -1)).toBeUndefined();
    expect(aimFor(shown, "c", "a", 1)).toBeUndefined();
    expect(aimFor(shown, "b", "c", 0)).toBeUndefined();
  });

  it("ne vise rien sur l'élément tiré lui-même, ni sur ce qui n'est pas affiché", () => {
    expect(aimFor(shown, "b", "b", 1)).toBeUndefined();
    expect(aimFor(shown, "b", "replié", 1)).toBeUndefined();
    expect(aimFor(shown, "absent", "c", 1)).toBeUndefined();
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
