import { describe, expect, it } from "vitest";

import { isInside, ownActiveTab, ownerOf, tabToShow } from "../src/lib/workspace";

describe("ownerOf", () => {
  const roots = ["C:\\Projets\\clide", "C:\\Projets\\clide\\packages\\web", "C:\\Projets\\atlas"];

  it("prend le projet le plus profond qui contient le chemin", () => {
    expect(ownerOf("C:\\Projets\\clide\\packages\\web\\src", roots)).toBe("C:\\Projets\\clide\\packages\\web");
    expect(ownerOf("C:\\Projets\\clide\\docs", roots)).toBe("C:\\Projets\\clide");
  });

  it("compare par segments, pas par préfixe", () => {
    expect(ownerOf("C:\\Projets\\clide-docs", roots)).toBeUndefined();
  });

  it("ignore la casse, les séparateurs et le séparateur final", () => {
    expect(ownerOf("c:/projets/ATLAS/", roots)).toBe("C:\\Projets\\atlas");
  });

  it("ne se rabat sur aucun projet quand rien ne contient le chemin", () => {
    expect(ownerOf("D:\\ailleurs", roots)).toBeUndefined();
    expect(ownerOf("C:\\Projets\\clide", [])).toBeUndefined();
  });
});

describe("isInside", () => {
  it("tient un dossier pour contenu en lui-même", () => {
    expect(isInside("C:\\a", "C:\\a")).toBe(true);
    expect(isInside("C:\\a\\b", "C:\\a")).toBe(false);
  });
});

describe("tabToShow", () => {
  const terminals = {
    a1: { owner: "A" },
    b1: { owner: "B" },
    a2: { owner: "A" },
  };

  it("rend l'onglet qu'on regardait dans le projet", () => {
    expect(tabToShow(terminals, "a1", "A")).toBe("a1");
  });

  it("prend le plus récent quand l'onglet retenu est fermé ou inconnu", () => {
    expect(tabToShow(terminals, "fermé", "A")).toBe("a2");
    expect(tabToShow(terminals, null, "A")).toBe("a2");
  });

  it("ne rend jamais l'onglet d'un autre projet", () => {
    expect(tabToShow(terminals, "b1", "A")).toBe("a2");
    expect(tabToShow(terminals, undefined, "C")).toBeNull();
  });
});

describe("ownActiveTab", () => {
  const terminals = { a1: { owner: "A" }, b1: { owner: "B" } };

  it("refuse un onglet actif qui appartient à un autre projet", () => {
    expect(ownActiveTab(terminals, "b1", "A")).toBeUndefined();
    expect(ownActiveTab(terminals, "a1", "A")).toBe("a1");
    expect(ownActiveTab(terminals, null, "A")).toBeUndefined();
    expect(ownActiveTab(terminals, "a1", null)).toBeUndefined();
  });
});
