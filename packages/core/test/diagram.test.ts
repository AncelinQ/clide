import { describe, expect, it } from "vitest";

import { extractMermaid, sessionDigest } from "../src/session/diagram.js";
import type { FileDiff } from "../src/files/history.js";

function diff(path: string, unified: string, extra: Partial<FileDiff> = {}): FileDiff {
  return {
    trackingPath: path,
    absolutePath: `C:\\p\\${path}`,
    created: false,
    deleted: false,
    beforeMissing: false,
    binary: false,
    linesAdded: 1,
    linesRemoved: 0,
    unified,
    ...extra,
  };
}

describe("sessionDigest", () => {
  it("donne les demandes, la liste des fichiers et leurs diffs", () => {
    const { text, truncated } = sessionDigest({
      title: "Aperçu",
      prompts: ["ajoute un aperçu", "  et   un bouton\n"],
      diffs: [diff("src/a.ts", "@@ -1 +1 @@\n+a"), diff("src/b.ts", "", { created: true })],
    });
    expect(truncated).toBe(false);
    expect(text).toContain("1. ajoute un aperçu\n2. et un bouton");
    expect(text).toContain("- src/a.ts +1 -0");
    expect(text).toContain("- src/b.ts (créé) +1 -0");
    expect(text).toContain("+a");
  });

  it("laisse sa part à chaque fichier quand un diff dépasse le budget", () => {
    const { text, truncated } = sessionDigest(
      { prompts: [], diffs: [diff("gros.ts", "x".repeat(50_000)), diff("petit.ts", "@@ petit @@")] },
      4_000,
    );
    expect(truncated).toBe(true);
    expect(text.length).toBeLessThan(4_200);
    expect(text).toContain("@@ petit @@");
  });

  it("n'envoie pas le contenu d'un fichier binaire", () => {
    const { text } = sessionDigest({ prompts: [], diffs: [diff("logo.png", "binaire", { binary: true })] });
    expect(text).toContain("- logo.png");
    expect(text).not.toContain("binaire");
  });
});

describe("extractMermaid", () => {
  it("prend le bloc mermaid d'une réponse", () => {
    expect(extractMermaid("Voici :\n```mermaid\nflowchart LR\n  a --> b\n```\n")).toBe("flowchart LR\n  a --> b");
  });

  it("accepte une réponse qui est un diagramme nu", () => {
    expect(extractMermaid("graph TD\n a-->b")).toBe("graph TD\n a-->b");
  });

  it("refuse une réponse sans diagramme", () => {
    expect(extractMermaid("Je ne peux pas.")).toBeUndefined();
  });
});
