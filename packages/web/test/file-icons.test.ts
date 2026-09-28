import { describe, expect, it } from "vitest";

import { iconFor, type IconMap } from "../src/lib/file-icons";

const TABLE: IconMap = {
  fileExtensions: { ts: "typescript", "d.ts": "typescript-def", md: "markdown" },
  fileNames: { "package.json": "package-json", readme: "readme" },
  folderNames: { src: "folder_src" },
};

describe("iconFor", () => {
  it("prend d'abord le nom exact, sans égard à la casse", () => {
    expect(iconFor("Package.json", false, false, TABLE)).toBe("package-json");
  });

  it("essaie les extensions de la plus longue à la plus courte", () => {
    expect(iconFor("types.d.ts", false, false, TABLE)).toBe("typescript-def");
    expect(iconFor("store.ts", false, false, TABLE)).toBe("typescript");
    expect(iconFor("NOTES.MD", false, false, TABLE)).toBe("markdown");
  });

  it("rend l'icône générique pour l'inconnu, fichier comme dossier", () => {
    expect(iconFor("Makefile", false, false, TABLE)).toBe("_file");
    expect(iconFor("divers", true, false, TABLE)).toBe("_folder");
  });

  it("donne sa variante ouverte à un dossier déplié", () => {
    expect(iconFor("src", true, true, TABLE)).toBe("folder_src_open");
    expect(iconFor("divers", true, true, TABLE)).toBe("_folder_open");
  });

  it("s'appuie sur la vraie table de Catppuccin par défaut", () => {
    expect(iconFor("index.ts", false)).toBe("typescript");
    expect(iconFor("src", true)).toBe("folder_src");
  });
});
