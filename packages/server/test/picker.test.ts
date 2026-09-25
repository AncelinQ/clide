import { describe, expect, it } from "vitest";

import { fileFilter, pickerScript } from "../src/platform/picker.js";

describe("sélecteur du système", () => {
  it("compose le filtre d'OpenFileDialog, point initial ou non", () => {
    expect(fileFilter(["md"])).toBe(".md|*.md");
    expect(fileFilter([".MD", "txt"])).toBe(".md, .txt|*.md;*.txt");
  });

  it("refuse une extension qui casserait la syntaxe du filtre", () => {
    expect(() => fileFilter(["md|*.exe"])).toThrow(/extension invalide/);
  });

  it("reçoit chemins et titre en paramètres, jamais recopiés dans le script", () => {
    const script = pickerScript();
    expect(script.startsWith("param([string] $Kind")).toBe(true);
    expect(script).toContain("OpenFileDialog");
    expect(script).toContain("FOS_PICKFOLDERS");
  });
});
