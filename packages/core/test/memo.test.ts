import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defaultLinkName, normalizeUrl, noteFileName, noteName } from "../src/memo/links.js";
import { MemoStore, memoNotesRoot } from "../src/memo/store.js";

describe("normalizeUrl", () => {
  it("accepte une adresse web, avec ou sans schéma, et une adresse mail", () => {
    expect(normalizeUrl(" https://exemple.fr/doc ")).toBe("https://exemple.fr/doc");
    expect(normalizeUrl("exemple.fr/doc")).toBe("https://exemple.fr/doc");
    expect(normalizeUrl("localhost:3000")).toBe("https://localhost:3000");
    expect(normalizeUrl("http://localhost:5173/")).toBe("http://localhost:5173/");
    expect(normalizeUrl("moi@exemple.fr")).toBe("mailto:moi@exemple.fr");
  });

  it("refuse ce qui ne s'ouvrirait pas dans le navigateur ou la messagerie", () => {
    expect(normalizeUrl("javascript:alert(1)")).toBeUndefined();
    expect(normalizeUrl("file:///C:/Windows/notepad.exe")).toBeUndefined();
    expect(normalizeUrl("vscode://ouvrir")).toBeUndefined();
    expect(normalizeUrl("deux mots")).toBeUndefined();
    expect(normalizeUrl("")).toBeUndefined();
  });
});

describe("noms", () => {
  it("nomme un lien par son hôte sans www, ou par l'adresse mail", () => {
    expect(defaultLinkName("https://www.exemple.fr/doc")).toBe("exemple.fr");
    expect(defaultLinkName("http://localhost:3000/")).toBe("localhost:3000");
    expect(defaultLinkName("mailto:moi@exemple.fr")).toBe("moi@exemple.fr");
  });

  it("fait d'un nom de note un nom de fichier, sans ce que Windows refuse", () => {
    expect(noteFileName(" Idées : v2 ")).toBe("Idées  v2.md");
    expect(noteFileName("plan.md")).toBe("plan.md");
    expect(noteFileName("..cachée.")).toBe("cachée.md");
    expect(noteFileName("CON")).toBeUndefined();
    expect(noteFileName(" / ")).toBeUndefined();
    expect(noteName("C:\\data\\memo\\abc\\plan.md")).toBe("plan");
  });
});

describe("MemoStore", () => {
  let dir: string;
  let store: MemoStore;
  let trashed: string[];
  const root = "C:\\Projets\\app";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "clide-memo-"));
    trashed = [];
    store = new MemoStore(join(dir, "data"), async (paths) => {
      trashed.push(...paths);
      await Promise.all(paths.map((path) => rm(path)));
    });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("garde les liens dans l'ordre, nommés par leur hôte quand on ne les nomme pas", async () => {
    await store.putLink(root, { name: "", url: "exemple.fr/doc" });
    await store.putLink(root, { name: "Ticket", url: "https://linear.app/x/1" });
    expect((await new MemoStore(join(dir, "data"), async () => undefined).load(root)).links).toEqual([
      { name: "exemple.fr", url: "https://exemple.fr/doc" },
      { name: "Ticket", url: "https://linear.app/x/1" },
    ]);
    const file = JSON.parse(await readFile(join(dir, "data", "memo.json"), "utf8")) as { version: number };
    expect(file.version).toBe(1);
  });

  it("refuse un doublon et une adresse invalide, et modifie un lien à sa place", async () => {
    await store.putLink(root, { name: "Doc", url: "https://exemple.fr" });
    await store.putLink(root, { name: "Autre", url: "https://autre.fr" });
    await expect(store.putLink(root, { name: "", url: "exemple.fr" })).rejects.toThrow(/déjà dans le mémo/);
    await expect(store.putLink(root, { name: "", url: "javascript:alert(1)" })).rejects.toThrow(/Adresse invalide/);
    await store.putLink(root, { name: "Doc v2", url: "https://exemple.fr/v2" }, "https://exemple.fr");
    expect((await store.load(root)).links.map((link) => link.name)).toEqual(["Doc v2", "Autre"]);
  });

  it("range liens et fichiers épinglés dans l'ordre donné, ce qu'il ne nomme pas à la fin", async () => {
    for (const url of ["https://a.fr", "https://b.fr", "https://c.fr"]) await store.putLink(root, { name: "", url });
    await store.orderLinks(root, ["https://c.fr", "https://a.fr"]);
    expect((await store.load(root)).links.map((link) => link.url)).toEqual(["https://c.fr", "https://a.fr", "https://b.fr"]);
    await store.removeLink(root, "https://a.fr");
    expect((await store.load(root)).links).toHaveLength(2);
  });

  it("épingle des fichiers absolus une seule fois, et dit ceux qui ont disparu", async () => {
    const present = join(dir, "present.ts");
    await writeFile(present, "");
    expect(await store.addPins(root, [present, join(dir, "parti.ts"), "relatif.ts", present])).toBe(2);
    expect(await store.addPins(root, [present])).toBe(0);
    expect((await store.load(root)).pins).toEqual([
      { path: present, exists: true },
      { path: join(dir, "parti.ts"), exists: false },
    ]);
    await store.orderPins(root, [join(dir, "parti.ts")]);
    await store.removePin(root, present);
    expect((await store.load(root)).pins.map((pin) => pin.path)).toEqual([join(dir, "parti.ts")]);
  });

  it("crée une note sous un nom libre, la renomme, et la met à la corbeille", async () => {
    const first = await store.newNote(root, "Plan");
    const second = await store.newNote(root, "Plan");
    expect(first).toBe(join(store.notesDir(root), "Plan.md"));
    expect(second).toBe(join(store.notesDir(root), "Plan 2.md"));
    expect(await readFile(first, "utf8")).toBe("# Plan\n\n");
    expect(store.notesDir(root).startsWith(memoNotesRoot(join(dir, "data")))).toBe(true);

    await expect(store.renameNote(root, second, "Plan")).rejects.toThrow(/porte déjà ce nom/);
    const renamed = await store.renameNote(root, second, "Idées");
    expect((await store.load(root)).notes.map((note) => note.name)).toEqual(["Idées", "Plan"]);

    await store.trashNote(root, renamed);
    expect(trashed).toEqual([renamed]);
    expect((await store.load(root)).notes.map((note) => note.name)).toEqual(["Plan"]);
  });

  it("refuse de toucher à un fichier qui n'est pas une note de ce projet", async () => {
    const note = await store.newNote(root, "Plan");
    const outside = join(dir, "projet.md");
    await writeFile(outside, "");
    await expect(store.trashNote(root, outside)).rejects.toThrow(/Note introuvable/);
    await expect(store.trashNote("C:\\Projets\\autre", note)).rejects.toThrow(/Note introuvable/);
    await expect(store.renameNote(root, join(store.notesDir(root), "..", "..", "memo.json"), "x")).rejects.toThrow(/Note introuvable/);
    expect(trashed).toEqual([]);
  });

  it("liste les projets dont le mémo n'est pas vide, notes seules comprises", async () => {
    await store.putLink("C:\\Projets\\b", { name: "", url: "https://b.fr" });
    await store.newNote("C:\\Projets\\a", "Seule");
    await store.removeLink("C:\\Projets\\vide", "https://rien.fr");
    expect((await store.list()).map((memo) => memo.root)).toEqual(["C:\\Projets\\a", "C:\\Projets\\b"]);
  });

  it("refuse de lire un fichier abîmé plutôt que de l'écraser, et écarte une entrée illisible", async () => {
    await mkdir(join(dir, "data"), { recursive: true });
    await writeFile(join(dir, "data", "memo.json"), "{ pas du json");
    await expect(store.load(root)).rejects.toThrow();
    await writeFile(
      join(dir, "data", "memo.json"),
      JSON.stringify({ version: 1, projects: { [root]: { links: [{ name: "x", url: "javascript:alert(1)" }, { name: "ok", url: "https://ok.fr" }], pins: ["relatif"] } } }),
    );
    expect(await store.load(root)).toMatchObject({ links: [{ name: "ok", url: "https://ok.fr" }], pins: [] });
  });
});
