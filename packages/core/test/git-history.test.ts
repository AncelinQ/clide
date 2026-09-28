import { describe, expect, it } from "vitest";

import { graphRows, parseChanges, parseCommits, parseNameStatus, type Commit } from "../src/git/history.js";

describe("parseChanges", () => {
  it("lit modifiés, ajoutés, supprimés, renommés, non suivis et conflits, noms à espaces compris", () => {
    const text = [
      "1 .M N... 100644 100644 100644 aaa bbb src/app.ts",
      "1 A. N... 000000 100644 100644 000 ccc docs/nouveau fichier.md",
      "1 .D N... 100644 100644 000000 ddd ddd vieux.txt",
      "2 R. N... 100644 100644 100644 eee eee R100 src/nouveau.ts",
      "src/ancien.ts",
      "u UU N... 100644 100644 100644 100644 f1 f2 f3 conflit.ts",
      "? brouillon.md",
      "",
    ].join("\0");
    expect(parseChanges(text)).toEqual([
      { path: "brouillon.md", kind: "untracked", staged: false },
      { path: "conflit.ts", kind: "conflict", staged: false },
      { path: "docs/nouveau fichier.md", kind: "added", staged: true },
      { path: "src/app.ts", kind: "modified", staged: false },
      { path: "src/nouveau.ts", from: "src/ancien.ts", kind: "renamed", staged: true },
      { path: "vieux.txt", kind: "deleted", staged: false },
    ]);
  });

  it("rend une liste vide pour un arbre propre", () => {
    expect(parseChanges("")).toEqual([]);
  });
});

describe("parseCommits", () => {
  it("lit hash, parents, auteur, date, références et sujet", () => {
    const text =
      "a1\x1fb2 c3\x1fAncelin\x1f2026-09-28T10:00:00+02:00\x1fHEAD -> main, origin/main, tag: v1\x1fMerge branche\x1e\n" +
      "b2\x1f\x1fAncelin\x1f2026-09-27T10:00:00+02:00\x1f\x1fPremier commit\x1e";
    expect(parseCommits(text)).toEqual([
      { hash: "a1", parents: ["b2", "c3"], author: "Ancelin", date: "2026-09-28T10:00:00+02:00", refs: ["main", "origin/main", "tag: v1"], subject: "Merge branche" },
      { hash: "b2", parents: [], author: "Ancelin", date: "2026-09-27T10:00:00+02:00", refs: [], subject: "Premier commit" },
    ]);
  });
});

describe("graphRows", () => {
  const commit = (hash: string, ...parents: string[]): Commit => ({ hash, parents, author: "", date: "", refs: [], subject: "" });

  it("garde une histoire linéaire sur une seule voie", () => {
    const rows = graphRows([commit("c", "b"), commit("b", "a"), commit("a")]);
    expect(rows.map((row) => row.column)).toEqual([0, 0, 0]);
    expect(rows.at(-1)?.after).toEqual([]);
  });

  it("ouvre une voie pour le second parent d'une fusion, et la referme sur lui", () => {
    // m fusionne f (branche) dans b ; f et b partent de a.
    const rows = graphRows([commit("m", "b", "f"), commit("f", "a"), commit("b", "a"), commit("a")]);
    expect(rows[0]).toMatchObject({ column: 0, after: ["b", "f"] });
    expect(rows[1]).toMatchObject({ hash: "f", column: 1, after: ["b", "a"] });
    expect(rows[2]).toMatchObject({ hash: "b", column: 0, after: ["a", "a"] });
    // a est attendu par deux voies : il prend la plus à gauche, l'autre se referme.
    expect(rows[3]).toMatchObject({ hash: "a", column: 0, after: [] });
  });
});

describe("parseNameStatus", () => {
  it("lit les fichiers d'un commit, renommages compris", () => {
    const text = ["M", "src/a.ts", "A", "src/b.ts", "D", "old.md", "R087", "src/c.ts", "src/d.ts", ""].join("\0");
    expect(parseNameStatus(text)).toEqual([
      { path: "src/a.ts", kind: "modified" },
      { path: "src/b.ts", kind: "added" },
      { path: "old.md", kind: "deleted" },
      { path: "src/d.ts", from: "src/c.ts", kind: "renamed" },
    ]);
  });
});
