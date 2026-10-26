import { describe, expect, it } from "vitest";

import { fileName, matchesFilter, shortUrl, underRoot } from "../src/lib/memo";

describe("matchesFilter", () => {
  it("trouve chaque mot, sans égard aux accents ni à la casse", () => {
    expect(matchesFilter("Idées de la v2", "idee V2")).toBe(true);
    expect(matchesFilter("Idées de la v2", "idée v3")).toBe(false);
    expect(matchesFilter("n'importe quoi", "  ")).toBe(true);
  });
});

describe("affichage", () => {
  it("montre l'adresse sans schéma ni barre finale", () => {
    expect(shortUrl("https://exemple.fr/doc/")).toBe("exemple.fr/doc");
    expect(shortUrl("mailto:moi@exemple.fr")).toBe("moi@exemple.fr");
  });

  it("nomme un fichier épinglé par son chemin sous le projet, ou entier ailleurs", () => {
    expect(underRoot("C:\\Projets\\app\\src\\main.ts", "C:\\Projets\\app")).toBe("src\\main.ts");
    expect(underRoot("C:\\projets\\APP\\README.md", "C:\\Projets\\app\\")).toBe("README.md");
    expect(underRoot("C:\\Projets\\app-2\\README.md", "C:\\Projets\\app")).toBe("C:\\Projets\\app-2\\README.md");
    expect(fileName("C:\\Projets\\app\\src\\main.ts")).toBe("main.ts");
  });
});
