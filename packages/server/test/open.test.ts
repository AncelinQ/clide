import { describe, expect, it } from "vitest";

import { isRunnable } from "../src/platform/open.js";

describe("isRunnable", () => {
  it("reconnaît ce que Windows exécuterait au lieu de l'ouvrir", () => {
    for (const name of ["setup.EXE", "build.cmd", "deploy.ps1", "tools/make-fixtures.js", "raccourci.lnk"]) {
      expect(isRunnable(name)).toBe(true);
    }
  });

  it("laisse ouvrir les fichiers qu'une application affiche", () => {
    for (const name of ["README.md", "src/index.ts", "App.tsx", "package.json", "logo.png", "Makefile"]) {
      expect(isRunnable(name)).toBe(false);
    }
  });
});
