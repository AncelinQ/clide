import { describe, expect, it } from "vitest";

import {
  EMPTY_SHELF,
  afterClose,
  backTarget,
  lookAt,
  natureOf,
  placementOf,
  selectedScript,
  shelfGroups,
  shelfOrder,
  shelfSummary,
  splitScriptKey,
  splitTabs,
  tabStops,
  type ScriptsShelf,
} from "../src/lib/script-shelf";
import type { TerminalInfo } from "../src/lib/types";

type Tab = Pick<TerminalInfo, "id" | "kind" | "script" | "state" | "exited">;

const tab = (id: string, script?: string, patch: Partial<Tab> = {}): Tab => ({
  id,
  kind: "shell",
  state: "idle",
  exited: false,
  ...(script ? { script: `C:\\p|${script}` } : {}),
  ...patch,
});

const shelf = (patch: Partial<ScriptsShelf> = {}): ScriptsShelf => ({ ...EMPTY_SHELF, ...patch });

describe("splitScriptKey", () => {
  it("sépare le dossier du nom au premier |", () => {
    expect(splitScriptKey("C:\\Projets\\api|test:watch")).toEqual({ directory: "C:\\Projets\\api", name: "test:watch" });
  });
});

describe("placementOf et splitTabs", () => {
  it("met dans l'onglet Scripts ce qui porte une clé, Claude compris", () => {
    expect(placementOf(tab("a", "dev"))).toBe("scripts");
    expect(placementOf(tab("b", "dev", { kind: "claude" }))).toBe("scripts");
    expect(placementOf(tab("c"))).toBe("bar");
  });

  it("garde l'ordre d'ouverture de part et d'autre", () => {
    const { bar, shelf: scripts } = splitTabs([tab("s1"), tab("d", "dev"), tab("s2"), tab("b", "build")]);
    expect(bar.map((item) => item.id)).toEqual(["s1", "s2"]);
    expect(scripts.map((item) => item.id)).toEqual(["d", "b"]);
  });

  it("laisse un rangement fait à la main l'emporter sur la règle, Claude compris", () => {
    const placed = { s1: "scripts", d: "bar", c: "scripts" } as const;
    expect(placementOf(tab("s1"), placed)).toBe("scripts");
    expect(placementOf(tab("d", "dev"), placed)).toBe("bar");
    expect(placementOf(tab("c", undefined, { kind: "claude" }), placed)).toBe("scripts");
    const { bar, shelf: scripts } = splitTabs([tab("s1"), tab("d", "dev"), tab("s2"), tab("b", "build")], placed);
    expect(bar.map((item) => item.id)).toEqual(["d", "s2"]);
    expect(scripts.map((item) => item.id)).toEqual(["s1", "b"]);
  });
});

describe("natureOf", () => {
  const nature = (name: string) => natureOf(tab("x", name));

  it.each([
    ["dev", "server"],
    ["start:prod", "server"],
    ["storybook", "server"],
    ["preview", "server"],
    ["run", "server"],
    ["runserver", "server"],
    ["test", "test"],
    ["test:unit", "test"],
    ["tests", "test"],
    ["pytest", "test"],
    ["e2e", "test"],
    ["build", "build"],
    ["build:prod", "build"],
    ["scripts/build.ps1", "build"],
    ["lint", "check"],
    ["typecheck", "check"],
    ["clippy", "check"],
    ["vet", "check"],
    ["install", "install"],
    ["web", "other"],
    ["release", "other"],
  ])("%s est %s", (name, expected) => {
    expect(nature(name)).toBe(expected);
  });

  it("tranche les noms mixtes par l'ordre des natures", () => {
    expect(nature("build-storybook")).toBe("build");
    expect(nature("test:watch")).toBe("test");
    expect(nature("lint:ci")).toBe("check");
    expect(nature("dev_build")).toBe("build");
  });

  it("ignore la casse", () => {
    expect(nature("Build")).toBe("build");
  });

  it("tient un terminal sans clé pour un shell", () => {
    expect(natureOf(tab("x"))).toBe("shell");
  });
});

describe("shelfGroups et shelfOrder", () => {
  const tabs = [tab("b", "build"), tab("d1", "dev"), tab("t", "test"), tab("d2", "storybook"), tab("o", "web")];

  it("range les groupes non vides dans l'ordre de la liste, chacun dans l'ordre d'ouverture", () => {
    expect(shelfGroups(tabs).map((group) => [group.nature, group.tabs.map((item) => item.id)])).toEqual([
      ["server", ["d1", "d2"]],
      ["test", ["t"]],
      ["build", ["b"]],
      ["other", ["o"]],
    ]);
  });

  it("met à plat les groupes dans l'ordre affiché", () => {
    expect(shelfOrder(tabs).map((item) => item.id)).toEqual(["d1", "d2", "t", "b", "o"]);
  });

  it("met les shells sans clé en dernier, même ouverts avant", () => {
    expect(shelfOrder([tab("sh"), tab("d", "dev")]).map((item) => item.id)).toEqual(["d", "sh"]);
  });

  it("rend à un script sorti puis rangé de nouveau son groupe, et aux shells rangés le leur", () => {
    const groups = shelfGroups([tab("sh1"), tab("b", "build"), tab("sh2", undefined, { kind: "claude" })]);
    expect(groups.map((group) => [group.nature, group.tabs.map((item) => item.id)])).toEqual([
      ["build", ["b"]],
      ["shell", ["sh1", "sh2"]],
    ]);
  });
});

describe("shelfSummary", () => {
  it("ne dit rien d'une liste vide", () => {
    expect(shelfSummary([], {})).toEqual({ running: 0, tone: "none", attention: false });
  });

  it("compte les scripts en cours, et un échec l'emporte sur eux", () => {
    expect(shelfSummary([tab("a", "dev", { state: "running" }), tab("b", "build")], {})).toEqual({ running: 1, tone: "running", attention: false });
    expect(shelfSummary([tab("a", "dev", { state: "running" }), tab("b", "lint", { state: "failed" })], {}).tone).toBe("failed");
    expect(shelfSummary([tab("b", "build")], {}).tone).toBe("idle");
  });

  it("laisse une session Claude et un shell terminé hors du compte", () => {
    const summary = shelfSummary([tab("c", "dev", { kind: "claude", state: "running" }), tab("x", "dev", { state: "failed", exited: true })], {});
    expect(summary).toEqual({ running: 0, tone: "idle", attention: false });
  });

  it("relève l'attention d'un des terminaux", () => {
    expect(shelfSummary([tab("c", "dev", { kind: "claude" })], { c: "permission" }).attention).toBe(true);
  });
});

describe("selectedScript", () => {
  it("rend le script retenu s'il est encore là, sinon le plus récemment ouvert", () => {
    expect(selectedScript(shelf({ selected: "a" }), ["a", "b"])).toBe("a");
    expect(selectedScript(shelf({ selected: "fermé" }), ["a", "b"])).toBe("b");
    expect(selectedScript(shelf(), [])).toBeNull();
  });
});

describe("backTarget", () => {
  it("rend l'onglet et le fichier retenus s'ils sont encore là", () => {
    expect(backTarget(shelf({ back: { tab: "c", file: "C:/x.ts" } }), ["c", "s"], ["C:/x.ts"])).toEqual({ tab: "c", file: "C:/x.ts" });
  });

  it("retombe sur le plus récent de la barre, et oublie un fichier fermé", () => {
    expect(backTarget(shelf({ back: { tab: "fermé", file: "C:/x.ts" } }), ["c", "s"], [])).toEqual({ tab: "s", file: null });
    expect(backTarget(shelf(), [], [])).toEqual({ tab: null, file: null });
  });
});

describe("lookAt", () => {
  const script = { id: "d", placement: "scripts" as const, nature: "server" as const };

  it("retient ce qu'on quitte dans la barre en entrant", () => {
    const next = lookAt(shelf(), { tab: "c", placement: "bar", file: "C:/x.ts" }, script);
    expect(next.selected).toBe("d");
    expect(next.back).toEqual({ tab: "c", file: "C:/x.ts" });
  });

  it("garde le retour quand on passe d'un script à l'autre", () => {
    const next = lookAt(shelf({ back: { tab: "c", file: null } }), { tab: "b", placement: "scripts", file: null }, script);
    expect(next.back).toEqual({ tab: "c", file: null });
    expect(next.selected).toBe("d");
  });

  it("garde l'onglet de retour en entrant depuis un fichier ouvert devant un script", () => {
    const next = lookAt(shelf({ back: { tab: "c", file: null } }), { tab: "b", placement: "scripts", file: "C:/x.ts" }, script);
    expect(next.back).toEqual({ tab: "c", file: "C:/x.ts" });
  });

  it("déplie le groupe du script regardé", () => {
    expect(lookAt(shelf({ folded: ["server", "test"] }), { tab: null, placement: null, file: null }, script).folded).toEqual(["test"]);
  });

  it("ne change rien quand on regarde un onglet de la barre", () => {
    const before = shelf({ selected: "d", back: { tab: "c", file: null } });
    expect(lookAt(before, { tab: "d", placement: "scripts", file: null }, { id: "c", placement: "bar", nature: "shell" })).toBe(before);
  });
});

describe("afterClose", () => {
  const ids = { bar: ["c1", "c2"], shelf: ["d1", "d2", "t"] };
  const back = { tab: "c2", file: "C:/x.ts" };

  it("montre le script suivant, ou le précédent pour le dernier", () => {
    expect(afterClose({ id: "d2", placement: "scripts" }, ids, back)).toEqual({ tab: "t", file: null });
    expect(afterClose({ id: "t", placement: "scripts" }, ids, back)).toEqual({ tab: "d2", file: null });
  });

  it("revient à la barre quand le dernier script se ferme", () => {
    expect(afterClose({ id: "d", placement: "scripts" }, { bar: ["c1"], shelf: ["d"] }, back)).toEqual(back);
    expect(afterClose({ id: "d", placement: "scripts" }, { bar: [], shelf: ["d"] }, { tab: null, file: null })).toEqual({ tab: null, file: null });
  });

  it("n'entre jamais dans l'onglet Scripts en fermant un onglet de la barre", () => {
    expect(afterClose({ id: "c1", placement: "bar" }, ids, back)).toEqual({ tab: "c2", file: null });
    expect(afterClose({ id: "c1", placement: "bar" }, { bar: ["c1"], shelf: ["d1"] }, back)).toEqual({ tab: null, file: null });
  });
});

describe("tabStops", () => {
  it("compte l'onglet Scripts pour un arrêt, en tête, sur son script retenu", () => {
    expect(tabStops(["c1", "c2"], ["d1", "d2"], shelf({ selected: "d1" }))).toEqual(["d1", "c1", "c2"]);
    expect(tabStops(["c1"], ["d1", "d2"], shelf())).toEqual(["d2", "c1"]);
    expect(tabStops(["c1"], [], shelf())).toEqual(["c1"]);
  });
});
