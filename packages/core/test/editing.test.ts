import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ChangedOnDisk, dominantEol, readEditable, writeEditable } from "../src/files/editing.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "clide-edit-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("dominantEol", () => {
  it("prend la fin de ligne la plus fréquente, \\n à égalité", () => {
    expect(dominantEol("a\r\nb\r\nc\n")).toBe("\r\n");
    expect(dominantEol("a\nb\r\n")).toBe("\n");
    expect(dominantEol("seul")).toBe("\n");
  });
});

describe("readEditable", () => {
  it("rend un texte en \\n, avec sa fin de ligne et son BOM d'origine", async () => {
    const path = join(root, "a.txt");
    await writeFile(path, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("un\r\ndeux\r\n")]));
    const file = await readEditable(path);
    expect(file).toMatchObject({ kind: "text", text: "un\ndeux\n", eol: "\r\n", bom: true });
  });

  it("tient pour binaire un fichier qui porte un octet nul", async () => {
    const path = join(root, "a.bin");
    await writeFile(path, Buffer.from([1, 0, 2]));
    expect((await readEditable(path)).kind).toBe("binary");
  });

  it("rend une image en base64", async () => {
    const path = join(root, "a.png");
    await writeFile(path, Buffer.from([0x89, 0x50]));
    expect(await readEditable(path)).toMatchObject({ kind: "image", mime: "image/png", base64: "iVA=" });
  });
});

describe("writeEditable", () => {
  it("rend la fin de ligne et le BOM d'origine, sans laisser de fichier temporaire", async () => {
    const path = join(root, "a.txt");
    await writeFile(path, "﻿un\r\n");
    const read = await readEditable(path);
    if (read.kind !== "text") throw new Error("texte attendu");
    await writeEditable(path, "un\ndeux\n", { expectedMtimeMs: read.mtimeMs, eol: read.eol, bom: read.bom });
    expect(await readFile(path, "utf8")).toBe("﻿un\r\ndeux\r\n");
    expect(await readdir(root)).toEqual(["a.txt"]);
  });

  it("refuse d'écrire un fichier qui a changé depuis sa lecture", async () => {
    const path = join(root, "a.txt");
    await writeFile(path, "v1");
    const read = await readEditable(path);
    await writeFile(path, "v2 écrit par Claude");
    const later = new Date(Date.now() + 5000);
    await utimes(path, later, later);
    await expect(writeEditable(path, "v1 modifié", { expectedMtimeMs: read.mtimeMs, eol: "\n", bom: false })).rejects.toBeInstanceOf(
      ChangedOnDisk,
    );
    expect(await readFile(path, "utf8")).toBe("v2 écrit par Claude");
  });
});
