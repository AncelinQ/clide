import { describe, expect, it } from "vitest";

import {
  addToGroup,
  barItems,
  createGroup,
  dropInBar,
  gather,
  groupByKind,
  groupTabId,
  hiddenTabs,
  nextColor,
  placeOpened,
  prune,
  removeFromGroup,
  renameMember,
  shiftInBar,
  ungroup,
  unfoldFor,
  type TabGroup,
  type TabGroups,
} from "../src/lib/tab-groups";

const group = (id: string, patch: Partial<TabGroup> = {}): TabGroup => ({ id, name: id.toUpperCase(), color: "blue", folded: false, ...patch });

/** Un état à partir de `{ groupe: [membres] }`. */
function groupsOf(spec: Record<string, string[]>, patches: Record<string, Partial<TabGroup>> = {}): TabGroups {
  return {
    groups: Object.keys(spec).map((id) => group(id, patches[id])),
    members: Object.fromEntries(Object.entries(spec).flatMap(([id, ids]) => ids.map((member) => [member, id]))),
  };
}

/** La barre en une ligne : `a [G: b c] d`, `[G…]` pour un groupe replié. */
function bar(order: readonly string[], state: TabGroups): string {
  return barItems(gather(order, state.members), state)
    .map((item) => (item.kind === "tab" ? item.id : item.group.folded ? `[${item.group.id}…]` : `[${item.group.id}: ${item.ids.join(" ")}]`))
    .join(" ");
}

describe("gather et barItems", () => {
  it("pose chaque groupe à la place de son premier membre", () => {
    const state = groupsOf({ g: ["b", "d"] });
    expect(gather(["a", "b", "c", "d"], state.members)).toEqual(["a", "b", "d", "c"]);
    expect(bar(["a", "b", "c", "d"], state)).toBe("a [g: b d] c");
  });

  it("ne montre pas un groupe dont aucun onglet n'est dans la barre", () => {
    expect(bar(["a"], groupsOf({ g: ["rangé-dans-scripts"] }))).toBe("a");
  });
});

describe("faits à la main", () => {
  it("crée un groupe à la place du premier onglet choisi, qui quitte l'ancien", () => {
    const state = groupsOf({ g: ["a"] });
    const result = createGroup(state, ["a", "b", "c"], ["c", "a"], group("n"));
    expect(bar(result.order, result.groups)).toBe("[n: a c] b");
    expect(result.groups.groups.map((item) => item.id)).toEqual(["n"]);
  });

  it("ajoute au bout du groupe, et retire juste après lui", () => {
    const state = groupsOf({ g: ["a", "b"] });
    const added = addToGroup(state, ["x", "a", "b", "y"], "x", "g");
    expect(bar(added.order, added.groups)).toBe("[g: a b x] y");
    const removed = removeFromGroup(added.groups, added.order, "a");
    expect(bar(removed.order, removed.groups)).toBe("[g: b x] a y");
  });

  it("efface un groupe vidé, et dégroupe sans rien déplacer", () => {
    const state = groupsOf({ g: ["a"] });
    expect(removeFromGroup(state, ["a", "b"], "a").groups.groups).toEqual([]);
    const two = groupsOf({ g: ["a", "b"] });
    expect(bar(["a", "b", "c"], ungroup(two, "g"))).toBe("a b c");
  });

  it("prend la première couleur libre", () => {
    expect(nextColor(groupsOf({}))).toBe("blue");
    expect(nextColor({ groups: [group("g", { color: "blue" })], members: {} })).toBe("red");
  });
});

describe("dropInBar", () => {
  const state = groupsOf({ g: ["b", "c"] });
  const order = ["a", "b", "c", "d"];

  it("donne à un onglet lâché sur un onglet le groupe de celui-ci, ou aucun", () => {
    const into = dropInBar(state, order, "d", "b", "after");
    expect(bar(into.order, into.groups)).toBe("a [g: b d c]");
    const out = dropInBar(state, order, "b", "a", "before");
    expect(bar(out.order, out.groups)).toBe("b a [g: c] d");
  });

  it("devant une étiquette pose hors du groupe, derrière fait entrer en tête", () => {
    const before = dropInBar(state, order, "d", groupTabId("g"), "before");
    expect(bar(before.order, before.groups)).toBe("a d [g: b c]");
    const after = dropInBar(state, order, "d", groupTabId("g"), "after");
    expect(bar(after.order, after.groups)).toBe("a [g: d b c]");
  });

  it("derrière un groupe replié, pose juste après lui sans y entrer", () => {
    const folded = groupsOf({ g: ["b", "c"] }, { g: { folded: true } });
    const result = dropInBar(folded, order, "a", groupTabId("g"), "after");
    expect(bar(result.order, result.groups)).toBe("[g…] a d");
    expect(result.groups.members["a"]).toBeUndefined();
  });

  it("emmène tout le groupe, devant ou derrière un onglet ou un autre groupe", () => {
    const moved = dropInBar(state, order, groupTabId("g"), "d", "after");
    expect(bar(moved.order, moved.groups)).toBe("a d [g: b c]");
    const two = groupsOf({ g: ["a", "b"], h: ["c", "d"] });
    const swapped = dropInBar(two, ["a", "b", "c", "d"], groupTabId("g"), "c", "after");
    expect(bar(swapped.order, swapped.groups)).toBe("[h: c d] [g: a b]");
  });
});

describe("shiftInBar", () => {
  it("sort du groupe à son bord, y entre au bord suivant", () => {
    const state = groupsOf({ g: ["b", "c"] });
    const out = shiftInBar(state, ["a", "b", "c", "d"], "c", 1);
    expect(bar(out.order, out.groups)).toBe("a [g: b] c d");
    const into = shiftInBar(out.groups, out.order, "c", -1);
    expect(bar(into.order, into.groups)).toBe("a [g: b c] d");
    const inside = shiftInBar(state, ["a", "b", "c", "d"], "b", 1);
    expect(bar(inside.order, inside.groups)).toBe("a [g: c b] d");
  });

  it("saute un groupe replié d'un coup", () => {
    const state = groupsOf({ g: ["b", "c"] }, { g: { folded: true } });
    const result = shiftInBar(state, ["a", "b", "c", "d"], "a", 1);
    expect(bar(result.order, result.groups)).toBe("[g…] a d");
  });
});

describe("par type", () => {
  it("réunit les onglets libres du type dans un nouveau groupe, sans prendre ceux déjà rangés", () => {
    const state = groupsOf({ g: ["c2"] });
    const result = groupByKind(state, ["c1", "s1", "c2", "c3"], "claude", ["c1", "c2", "c3"], group("k"));
    expect(result && bar(result.order, result.groups)).toBe("[k: c1 c3] s1 [g: c2]");
    expect(result?.groups.groups.find((item) => item.id === "k")?.kind).toBe("claude");
  });

  it("refait le geste dans le groupe du type qui existe déjà, et ne fait rien sans onglet libre", () => {
    const state: TabGroups = { groups: [group("k", { kind: "claude" })], members: { c1: "k" } };
    const result = groupByKind(state, ["c1", "s1", "c2"], "claude", ["c1", "c2"], group("autre"));
    expect(result && bar(result.order, result.groups)).toBe("[k: c1 c2] s1");
    expect(groupByKind(state, ["c1", "s1"], "claude", ["c1"], group("autre"))).toBeUndefined();
  });

  it("ouvre à côté du groupe de son type, ou dedans en le dépliant", () => {
    const state: TabGroups = { groups: [group("k", { kind: "shell", folded: true })], members: { s1: "k", s2: "k" } };
    const beside = placeOpened(state, ["s1", "a", "s2", "b"], "new", "shell", "beside");
    expect(beside && bar(beside.order, beside.groups)).toBe("[k…] new a b");
    const join = placeOpened(state, ["s1", "s2", "a", "new"], "new", "shell", "join");
    expect(join && bar(join.order, join.groups)).toBe("[k: s1 s2 new] a");
  });

  it("laisse un onglet ouvert sans groupe de son type aller au bout", () => {
    const state: TabGroups = { groups: [group("k", { kind: "shell" })], members: { s1: "k" } };
    expect(placeOpened(state, ["s1", "new"], "new", "claude", "join")).toBeUndefined();
    expect(placeOpened(groupsOf({ g: ["s1"] }), ["s1", "new"], "new", "shell", "join")).toBeUndefined();
  });
});

describe("repli, fermeture, renommage", () => {
  it("cache les onglets d'un groupe replié, et le déplie pour en montrer un", () => {
    const state = groupsOf({ g: ["b"] }, { g: { folded: true } });
    expect([...hiddenTabs(state, ["a", "b"])]).toEqual(["b"]);
    expect(unfoldFor(state, "b")?.groups[0]?.folded).toBe(false);
    expect(unfoldFor(state, "a")).toBeUndefined();
  });

  it("oublie les onglets fermés et les groupes vidés, rien s'ils vivent tous", () => {
    const state = groupsOf({ g: ["a"], h: ["b", "c"] });
    const pruned = prune(state, (id) => id !== "a" && id !== "b");
    expect(pruned).toEqual(groupsOf({ h: ["c"] }));
    expect(prune(state, () => true)).toBe(state);
  });

  it("suit un fichier renommé", () => {
    const state = groupsOf({ g: ["C:/a.ts"] });
    expect(renameMember(state, (id) => id.replace("a.ts", "b.ts")).members).toEqual({ "C:/b.ts": "g" });
  });
});
