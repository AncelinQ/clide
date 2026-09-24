import { describe, expect, it } from "vitest";

import { DevUrlScanner, findDevUrl, plainText } from "../src/pty/dev-url.js";

const ESC = "\u001b";

describe("findDevUrl", () => {
  it("lit la ligne Local de vite", () => {
    expect(findDevUrl("  ➜  Local:   http://localhost:5173/\n  ➜  Network: use --host to expose")).toBe(
      "http://localhost:5173/",
    );
  });

  it("lit la ligne Local de next dev", () => {
    expect(findDevUrl("   ▲ Next.js 15.1.0\n   - Local:        http://localhost:3000\n")).toBe("http://localhost:3000");
  });

  it("ouvre par localhost un serveur qui écoute sur toutes les interfaces", () => {
    expect(findDevUrl("listening on http://0.0.0.0:8080/app")).toBe("http://localhost:8080/app");
    expect(findDevUrl("listening on http://[::]:8080")).toBe("http://localhost:8080");
  });

  it("ignore une adresse du réseau local ou d'Internet", () => {
    expect(findDevUrl("Network: http://192.168.1.12:5173/")).toBeUndefined();
    expect(findDevUrl("voir https://vite.dev/guide/")).toBeUndefined();
  });

  it("exige un port, que tout serveur de développement affiche", () => {
    expect(findDevUrl("proxy vers http://localhost/api")).toBeUndefined();
  });

  it("retire la ponctuation qui suit l'adresse", () => {
    expect(findDevUrl("Serveur prêt (http://127.0.0.1:4321).")).toBe("http://127.0.0.1:4321");
  });
});

describe("plainText", () => {
  it("retire les couleurs, y compris au milieu d'une adresse", () => {
    expect(plainText(`http://localhost:${ESC}[1m5173${ESC}[22m/`)).toBe("http://localhost:5173/");
  });

  it("sépare deux lignes que ConPTY place par positionnement du curseur", () => {
    expect(plainText(`a${ESC}[3;1Hb`)).toBe("a\nb");
  });
});

describe("DevUrlScanner", () => {
  it("attend la fin de la ligne avant de lire une adresse coupée entre deux morceaux", () => {
    const scanner = new DevUrlScanner();
    expect(scanner.push("  Local:   http://localhost:51")).toBeUndefined();
    expect(scanner.push("73/\r\n")).toBe("http://localhost:5173/");
  });

  it("recolle une séquence de couleur coupée entre deux morceaux", () => {
    const scanner = new DevUrlScanner();
    expect(scanner.push(`Local: http://localhost:${ESC}[1`)).toBeUndefined();
    expect(scanner.push(`m5173${ESC}[22m/\n`)).toBe("http://localhost:5173/");
  });

  it("écarte la ligne tapée, que le shell redessine au lancement de la commande", () => {
    const scanner = new DevUrlScanner();
    scanner.reset({ skipLine: true });
    expect(scanner.push(`${ESC}[1;3Hcurl http://localhost:3000\r\n`)).toBeUndefined();
    expect(scanner.push("Local: http://localhost:5173/\r\n")).toBe("http://localhost:5173/");
  });

  it("oublie la ligne en attente quand on le remet à zéro", () => {
    const scanner = new DevUrlScanner();
    scanner.push("http://localhost:3000");
    scanner.reset();
    expect(scanner.push("\n")).toBeUndefined();
  });
});
