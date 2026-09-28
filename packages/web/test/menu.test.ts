import { describe, expect, it } from "vitest";

import { tidy, type MenuItem } from "../src/lib/menu";

const item = (label: string): MenuItem => ({ kind: "item", label, run: () => undefined });
const sep: MenuItem = { kind: "separator" };

describe("tidy", () => {
  it("retire les séparateurs en tête, en fin et doublés", () => {
    expect(tidy([sep, item("a"), sep, sep, item("b"), sep]).map((entry) => entry.kind)).toEqual([
      "item",
      "separator",
      "item",
    ]);
  });

  it("range aussi les sous-menus", () => {
    const [submenu] = tidy([{ kind: "submenu", label: "s", items: [sep, item("a"), sep] }]);
    expect(submenu?.kind === "submenu" && submenu.items.map((entry) => entry.kind)).toEqual(["item"]);
  });

  it("rend un menu vide pour des séparateurs seuls", () => {
    expect(tidy([sep, sep])).toEqual([]);
  });
});
