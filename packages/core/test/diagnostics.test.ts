import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { findTodos, parseEslint, parseTsc } from "../src/diagnostics/parse.js";

describe("parseTsc", () => {
  const cwd = join("C:", "projet", "web");

  it("lit chemin, ligne, colonne, code et message, chemin relatif au dossier de tsc", () => {
    const out = [
      "src/app.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.",
      "src\\lib\\x.ts(3,1): error TS7006: Parameter 'a' implicitly has an 'any' type.",
      "Found 2 errors in 2 files.",
    ].join("\r\n");
    expect(parseTsc(out, cwd)).toEqual([
      {
        path: join(cwd, "src/app.ts"),
        line: 12,
        column: 5,
        severity: "error",
        message: "Type 'string' is not assignable to type 'number'.",
        source: "tsc",
        code: "TS2322",
      },
      {
        path: join(cwd, "src\\lib\\x.ts"),
        line: 3,
        column: 1,
        severity: "error",
        message: "Parameter 'a' implicitly has an 'any' type.",
        source: "tsc",
        code: "TS7006",
      },
    ]);
  });

  it("rattache les lignes de suite à leur erreur", () => {
    const out = "a.ts(1,1): error TS2345: Argument of type 'X'\n  Type 'X' is missing property 'y'.";
    expect(parseTsc(out, cwd)[0]?.message).toBe("Argument of type 'X'\nType 'X' is missing property 'y'.");
  });
});

describe("parseEslint", () => {
  it("lit les messages de chaque fichier, erreurs et avertissements", () => {
    const out = JSON.stringify([
      { filePath: "C:/p/a.ts", messages: [{ line: 2, column: 7, severity: 2, message: "'x' is unused.", ruleId: "no-unused-vars" }] },
      { filePath: "C:/p/b.ts", messages: [{ severity: 1, message: "Parsing warning", ruleId: null }] },
    ]);
    expect(parseEslint(out)).toEqual([
      { path: "C:/p/a.ts", line: 2, column: 7, severity: "error", message: "'x' is unused.", source: "eslint", code: "no-unused-vars" },
      { path: "C:/p/b.ts", line: 1, column: 1, severity: "warning", message: "Parsing warning", source: "eslint" },
    ]);
  });

  it("refuse une sortie qui n'est pas du JSON", () => {
    expect(() => parseEslint("Oops! Something went wrong")).toThrow();
  });
});

describe("findTodos", () => {
  it("trouve les marqueurs dans chaque forme de commentaire", () => {
    const text = [
      "// TODO: brancher l'API",
      "const a = 1; /* FIXME cas limite */",
      "# HACK: contournement",
      "<!-- XXX à relire -->",
      " * TODO dans un bloc",
    ].join("\n");
    expect(findTodos("a.ts", text).map((todo) => `${todo.line}:${todo.code}:${todo.message}`)).toEqual([
      "1:TODO:brancher l'API",
      "2:FIXME:cas limite",
      "3:HACK:contournement",
      "4:XXX:à relire",
      "5:TODO:dans un bloc",
    ]);
  });

  it("ignore un marqueur hors commentaire dans du code, pas dans du Markdown", () => {
    expect(findTodos("a.ts", 'const label = "TODO: rien";')).toEqual([]);
    expect(findTodos("notes.md", "- TODO: écrire le guide")).toEqual([
      expect.objectContaining({ line: 1, code: "TODO", message: "écrire le guide" }),
    ]);
  });

  it("ne prend pas un mot qui contient le marqueur", () => {
    expect(findTodos("a.ts", "// TODOS et HACKER ne comptent pas")).toEqual([]);
  });
});
