import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PromptStore, projectPromptsFile, slashCommandOf, topCommands } from "../src/prompts/store.js";

let dir: string;
let project: string;
let store: PromptStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "clide-prompts-"));
  project = join(dir, "projet");
  await mkdir(project);
  store = new PromptStore(join(dir, "data", "prompts.json"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("PromptStore", () => {
  it("range les prompts perso et ceux du projet dans leurs fichiers, le projet d'abord", async () => {
    await store.save({ label: "Brainstorm", text: "/sc:brainstorm {saisie}", mode: "insert", scope: "user" });
    await store.save({ label: "Tests", text: "Lance les tests", mode: "send", scope: "project" }, project);
    const listed = await store.list(project);
    expect(listed.map((prompt) => `${prompt.scope}:${prompt.label}`)).toEqual(["project:Tests", "user:Brainstorm"]);
    const file = JSON.parse(await readFile(projectPromptsFile(project), "utf8")) as { version: number; prompts: unknown[] };
    expect(file.version).toBe(1);
    expect(file.prompts).toHaveLength(1);
  });

  it("remplace un prompt par son identifiant, et le retire", async () => {
    const saved = await store.save({ label: "A", text: "a", mode: "send", scope: "user" });
    await store.save({ ...saved, label: "B" });
    expect((await store.list()).map((prompt) => prompt.label)).toEqual(["B"]);
    await store.remove(saved.id, "user");
    expect(await store.list()).toEqual([]);
  });

  it("refuse un nom ou un texte vide, et un prompt de projet sans projet", async () => {
    await expect(store.save({ label: " ", text: "x", mode: "send", scope: "user" })).rejects.toThrow(/nom/);
    await expect(store.save({ label: "x", text: "", mode: "send", scope: "user" })).rejects.toThrow(/vide/);
    await expect(store.save({ label: "x", text: "y", mode: "send", scope: "project" })).rejects.toThrow(/projet/);
  });

  it("écarte une entrée abîmée sans perdre les autres, et refuse un fichier qui n'est pas du JSON", async () => {
    await mkdir(join(dir, "data"), { recursive: true });
    await writeFile(
      join(dir, "data", "prompts.json"),
      JSON.stringify({ version: 1, prompts: [{ id: "1", label: "Bon", text: "t", mode: "send" }, { id: 2 }] }),
    );
    expect((await store.list()).map((prompt) => prompt.label)).toEqual(["Bon"]);
    await writeFile(join(dir, "data", "prompts.json"), "{ pas du json");
    await expect(store.list()).rejects.toThrow();
  });
});

describe("commandes tapées", () => {
  const typed = (command: string, at = "2026-09-20T10:00:00Z") => ({
    text: `<command-message>x</command-message> <command-name>${command}</command-name> <command-args>y</command-args>`,
    at,
  });

  it("lit le nom d'une commande dans le texte du transcript", () => {
    expect(slashCommandOf(typed("/sc:brainstorm").text)).toBe("/sc:brainstorm");
    expect(slashCommandOf("un prompt ordinaire")).toBeUndefined();
  });

  it("classe les plus tapées, au-dessus d'un seuil, depuis une date, hors de celles déjà enregistrées", () => {
    const entries = [
      ...Array.from({ length: 5 }, () => typed("/sc:brainstorm")),
      ...Array.from({ length: 3 }, () => typed("/review")),
      ...Array.from({ length: 2 }, () => typed("/rare")),
      ...Array.from({ length: 4 }, () => typed("/ancienne", "2026-01-01T00:00:00Z")),
      ...Array.from({ length: 4 }, () => typed("/connue")),
    ];
    expect(
      topCommands(entries, { since: Date.parse("2026-09-01T00:00:00Z"), minimum: 3, exclude: new Set(["/connue"]) }),
    ).toEqual([
      { command: "/sc:brainstorm", count: 5 },
      { command: "/review", count: 3 },
    ]);
  });
});
