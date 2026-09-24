import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TEXT_LIMIT, previewFile } from "../src/files/preview.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "clide-preview-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 3 });
});

describe("previewFile", () => {
  it("rend le texte en entier quand il tient", async () => {
    await writeFile(join(root, "README.md"), "# titre\n", "utf8");
    const preview = await previewFile(root, "README.md");
    expect(preview).toMatchObject({ kind: "text", text: "# titre\n", truncated: false });
  });

  it("tronque un long texte sans couper un caractère en deux", async () => {
    // « é » tient sur deux octets : la limite tombe au milieu de l'un d'eux.
    await writeFile(join(root, "long.txt"), `a${"é".repeat(TEXT_LIMIT)}`, "utf8");
    const preview = await previewFile(root, "long.txt");
    expect(preview.kind).toBe("text");
    if (preview.kind !== "text") return;
    expect(preview.truncated).toBe(true);
    expect(preview.text.endsWith("é")).toBe(true);
    expect(preview.text).not.toContain("\uFFFD");
  });

  it("reconnaît un binaire à son octet nul", async () => {
    await writeFile(join(root, "data.bin"), Buffer.from([1, 2, 0, 3]));
    expect((await previewFile(root, "data.bin")).kind).toBe("binary");
  });

  it("envoie une image en base64 avec son type", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
    await writeFile(join(root, "logo.png"), png);
    const preview = await previewFile(root, "logo.png");
    expect(preview).toMatchObject({ kind: "image", mime: "image/png", base64: png.toString("base64") });
  });

  it("refuse un chemin qui sort du projet", async () => {
    await expect(previewFile(root, "../ailleurs.txt")).rejects.toThrow("hors du projet");
    await expect(previewFile(root, String.raw`C:\Windows\win.ini`)).rejects.toThrow("hors du projet");
  });
});
