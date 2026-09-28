import { describe, expect, it } from "vitest";

import { expand, variablesOf } from "../src/lib/prompt-vars";

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

  it("rend le texte tel quel quand il n'a pas de variable", () => {
    expect(expand("/review", {})).toEqual({ text: "/review" });
  });
});
