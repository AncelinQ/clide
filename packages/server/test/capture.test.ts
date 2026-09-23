import { describe, expect, it } from "vitest";

import { captureScript } from "../src/platform/capture.js";

describe("captureScript", () => {
  const script = captureScript();

  it("ouvre l'outil de capture de Windows", () => {
    expect(script).toContain("Start-Process 'ms-screenclip:'");
  });

  it("attend un changement du presse-papiers, pas une image déjà là", () => {
    // Le compteur est relevé avant l'ouverture : une image copiée plus tôt ne
    // passe pas pour la capture.
    expect(script.indexOf("$before = ")).toBeLessThan(script.indexOf("Start-Process"));
    expect(script).toContain("GetClipboardSequenceNumber() -ne $before");
  });

  it("n'écrit jamais dans le presse-papiers", () => {
    expect(script).not.toMatch(/SetImage|SetText|SetData|Set-Clipboard|Clear\(/);
  });

  it("sort sur un code distinct quand rien n'est capturé", () => {
    expect(script.trimEnd().endsWith("exit 2")).toBe(true);
  });
});
