import { describe, expect, it } from "vitest";

import { clipboardKey, isTerminalReply, quotePath } from "../src/lib/terminal-input";

describe("isTerminalReply", () => {
  it("reconnaît les réponses de xterm au programme", () => {
    expect(isTerminalReply("\u001b[12;40R")).toBe(true);
    expect(isTerminalReply("\u001b[?1;2c")).toBe(true);
    expect(isTerminalReply("\u001b[>0;276;0c")).toBe(true);
    expect(isTerminalReply("\u001b[I")).toBe(true);
    expect(isTerminalReply("\u001b[O")).toBe(true);
    expect(isTerminalReply("\u001b]11;rgb:1e1e/1e1e/1e1e\u0007")).toBe(true);
    expect(isTerminalReply("\u001b]10;rgb:ffff/ffff/ffff\u001b\\")).toBe(true);
  });

  it("tient le reste pour une frappe", () => {
    expect(isTerminalReply("claude\r")).toBe(false);
    expect(isTerminalReply("\r")).toBe(false);
    expect(isTerminalReply("\u0003")).toBe(false);
    expect(isTerminalReply("\u001b[A")).toBe(false);
    expect(isTerminalReply("\u001b")).toBe(false);
    expect(isTerminalReply("\u001b[200~npm i\u001b[201~")).toBe(false);
  });
});

describe("clipboardKey", () => {
  const key = (letter: string, extra: Partial<KeyboardEvent> = {}) => ({
    type: "keydown",
    key: letter,
    ctrlKey: true,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...extra,
  });

  it("colle sur Ctrl+V, sélection ou non", () => {
    expect(clipboardKey(key("v"), false)).toBe("paste");
    expect(clipboardKey(key("V"), true)).toBe("paste");
  });

  it("copie sur Ctrl+C seulement s'il y a une sélection, sinon laisse l'interruption", () => {
    expect(clipboardKey(key("c"), true)).toBe("copy");
    expect(clipboardKey(key("c"), false)).toBeUndefined();
  });

  it("laisse passer les autres combinaisons et les autres phases de la frappe", () => {
    expect(clipboardKey(key("v", { altKey: true }), false)).toBeUndefined();
    expect(clipboardKey(key("c", { shiftKey: true }), true)).toBeUndefined();
    expect(clipboardKey(key("v", { ctrlKey: false }), false)).toBeUndefined();
    expect(clipboardKey(key("v", { type: "keyup" }), false)).toBeUndefined();
    expect(clipboardKey(key("x"), true)).toBeUndefined();
  });
});

describe("quotePath", () => {
  it("laisse un chemin ordinaire tel quel", () => {
    expect(quotePath("C:\\Projets\\clide\\a.ts")).toBe("C:\\Projets\\clide\\a.ts");
  });

  it("met entre guillemets doubles un chemin à espace ou à caractère spécial de PowerShell", () => {
    expect(quotePath("C:\\Mes Projets\\a.ts")).toBe('"C:\\Mes Projets\\a.ts"');
    expect(quotePath("C:\\x\\a (1).png")).toBe('"C:\\x\\a (1).png"');
    expect(quotePath("C:\\R&D\\a.ts")).toBe('"C:\\R&D\\a.ts"');
    expect(quotePath("C:\\x\\l'outil.ts")).toBe('"C:\\x\\l\'outil.ts"');
  });

  it("garde $ et ` littéraux : guillemets simples, apostrophe doublée", () => {
    expect(quotePath("C:\\data\\$cache\\x.txt")).toBe("'C:\\data\\$cache\\x.txt'");
    expect(quotePath("C:\\a`b\\l'outil.txt")).toBe("'C:\\a`b\\l''outil.txt'");
  });
});
