import { describe, expect, it } from "vitest";

import { departure, expand, variablesOf } from "../src/lib/prompt-vars";

describe("variablesOf", () => {
  it("rend chaque variable une fois, accentuée ou non", () => {
    expect(variablesOf("{selection} puis {fichier}, encore {sélection} et {inconnue}")).toEqual(["sélection", "fichier"]);
  });
});

describe("expand", () => {
  it("remplace les variables et laisse les autres accolades", () => {
    expect(expand("/sc:brainstorm {saisie} sur {branche} {json}", { saisie: "le menu", branche: "main" })).toEqual({
      text: "/sc:brainstorm le menu sur main {json}",
    });
  });

  it("s'arrête sur la première variable sans valeur", () => {
    expect(expand("explique {sélection}", {})).toEqual({ missing: "sélection" });
    expect(expand("explique {Selection}", { sélection: "" })).toEqual({ missing: "sélection" });
  });

  it("envoie sans sa saisie un prompt dont la saisie reste vide, sans laisser de blanc", () => {
    expect(expand("/sc:brainstorm {saisie}", { saisie: "" })).toEqual({ text: "/sc:brainstorm" });
    expect(expand("/review {saisie} sur {branche}", { saisie: "", branche: "main" })).toEqual({ text: "/review sur main" });
    expect(expand("{saisie}\nrelis le diff", { saisie: "" })).toEqual({ text: "relis le diff" });
  });

  it("rend le texte tel quel quand il n'a pas de variable", () => {
    expect(expand("/review", {})).toEqual({ text: "/review" });
  });
});

describe("departure", () => {
  it("valide toujours un prompt « envoyer »", () => {
    expect(departure({ text: "/review", mode: "send" }, false)).toBe("send");
    expect(departure({ text: "/review {saisie}", mode: "send" }, false)).toBe("send");
  });

  it("laisse un prompt « insérer » à compléter, sauf sa saisie donnée avec l'envoi direct", () => {
    expect(departure({ text: "/sc:brainstorm {saisie}", mode: "insert" }, false)).toBe("insert");
    expect(departure({ text: "/sc:brainstorm {saisie}", mode: "insert" }, true)).toBe("send");
    expect(departure({ text: "explique {sélection}", mode: "insert" }, true)).toBe("insert");
  });
});
