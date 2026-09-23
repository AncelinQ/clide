import { describe, expect, it } from "vitest";

import { OSC_CODE, OscScanner, uriToPath } from "../src/pty/osc.js";

const ESC = "\u001b";
const BEL = "\u0007";
const osc = (body: string): string => `${ESC}]${body}${BEL}`;
const cwd = (uri: string): string => osc(`7;${uri}`);
const end = (code: number): string => osc(`${OSC_CODE};END;${code}`);
const start = (): string => osc(`${OSC_CODE};START`);

describe("uriToPath", () => {
  it("convertit une URI de fichier en chemin Windows", () => {
    expect(uriToPath("file:///C:/Projets/app")).toBe("C:\\Projets\\app");
  });

  it("décode les caractères échappés", () => {
    expect(uriToPath("file:///C:/Mes%20Projets/app")).toBe("C:\\Mes Projets\\app");
  });

  it("garde un chemin UNC", () => {
    expect(uriToPath("file://serveur/partage")).toBe("serveur\\partage");
  });

  it("refuse ce qui n'est pas une URI de fichier", () => {
    expect(uriToPath("https://exemple.invalid")).toBeUndefined();
  });
});

describe("OscScanner", () => {
  it("extrait le dossier courant et le retire du flux", () => {
    const { text, events } = new OscScanner().push(`avant${cwd("file:///C:/Projets/app")}après`);
    expect(text).toBe("avantaprès");
    expect(events).toEqual([{ kind: "cwd", path: "C:\\Projets\\app" }]);
  });

  it("lit le code de sortie d'une commande", () => {
    const { events } = new OscScanner().push(end(1));
    expect(events).toEqual([{ kind: "command-end", exitCode: 1 }]);
  });

  it("lit le début de commande", () => {
    expect(new OscScanner().push(start()).events).toEqual([{ kind: "command-start" }]);
  });

  it("lit le lancement de claude avec sa ligne de commande entière", () => {
    const { text, events } = new OscScanner().push(osc("7771;CLAUDE_START;claude -r abc; --verbose"));
    expect(text).toBe("");
    expect(events).toEqual([{ kind: "claude-start", command: "claude -r abc; --verbose" }]);
    expect(new OscScanner().push(osc("7771;CLAUDE_END")).events).toEqual([{ kind: "claude-end" }]);
  });

  it("laisse passer les séquences qui ne sont pas les nôtres", () => {
    // OSC 0 fixe le titre de la fenêtre : xterm doit le recevoir.
    const title = osc("0;pwsh.exe");
    const { text, events } = new OscScanner().push(title);
    expect(text).toBe(title);
    expect(events).toEqual([]);
  });

  it("recolle une séquence coupée entre deux lectures", () => {
    const scanner = new OscScanner();
    const complete = cwd("file:///C:/Projets/app");
    const cut = Math.floor(complete.length / 2);

    const first = scanner.push(`début${complete.slice(0, cut)}`);
    expect(first.text).toBe("début");
    expect(first.events).toEqual([]);
    expect(scanner.pendingLength).toBeGreaterThan(0);

    const second = scanner.push(`${complete.slice(cut)}fin`);
    expect(second.text).toBe("fin");
    expect(second.events).toEqual([{ kind: "cwd", path: "C:\\Projets\\app" }]);
  });

  it("accepte le terminateur ST autant que BEL", () => {
    const { events } = new OscScanner().push(`${ESC}]7;file:///C:/x${ESC}\\`);
    expect(events).toEqual([{ kind: "cwd", path: "C:\\x" }]);
  });

  it("traite plusieurs séquences dans une même lecture", () => {
    const { text, events } = new OscScanner().push(
      `${start()}sortie${cwd("file:///C:/x")}${end(0)}`,
    );
    expect(text).toBe("sortie");
    expect(events.map((event) => event.kind)).toEqual(["command-start", "cwd", "command-end"]);
  });

  it("ne retient pas indéfiniment un ESC ] isolé dans des données", () => {
    const scanner = new OscScanner();
    const noise = `${ESC}]${"x".repeat(OscScanner.MAX_PENDING + 10)}`;
    const { text } = scanner.push(noise);

    expect(scanner.pendingLength).toBe(0);
    expect(text).toBe(noise);
  });

  it("ignore un marqueur inconnu de notre propre code", () => {
    const { text, events } = new OscScanner().push(osc(`${OSC_CODE};INVENTE`));
    expect(events).toEqual([]);
    expect(text).toBe("");
  });
});
