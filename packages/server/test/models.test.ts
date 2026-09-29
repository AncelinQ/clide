import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listModels, modelsFromCatalog } from "../src/platform/models.js";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "clide-models-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("catalogue des modèles", () => {
  it("met les modèles principaux d'abord, dans l'ordre du catalogue", () => {
    const models = modelsFromCatalog({
      catalog: {
        config: {
          models: [
            { id: "claude-opus-5", name: "Opus 5", section: "overflow" },
            { id: "claude-opus-5-5", name: "Opus 5.5", description: "Le plus capable", section: "main" },
            { id: "claude-haiku", name: "Haiku", quick_select: true },
            { name: "sans identifiant" },
          ],
        },
      },
    });
    expect(models).toEqual([
      { id: "claude-opus-5-5", name: "Opus 5.5", description: "Le plus capable", main: true, efforts: [] },
      { id: "claude-haiku", name: "Haiku", main: true, efforts: [] },
      { id: "claude-opus-5", name: "Opus 5", main: false, efforts: [] },
    ]);
  });

  it("lit les niveaux d'effort du modèle et celui qui est recommandé", () => {
    const [model] = modelsFromCatalog({
      catalog: {
        config: {
          models: [
            {
              id: "claude-opus-5-5",
              name: "Opus 5.5",
              section: "main",
              thinking: {
                type: "effort",
                effort_options: [
                  { id: "low", name: "Low" },
                  { id: "medium", name: "Medium", badge: { message: "Recommended", variant: "neutral" } },
                  { id: "xhigh", name: "Extra" },
                  { name: "sans identifiant" },
                ],
              },
            },
          ],
        },
      },
    });
    expect(model?.efforts).toEqual([
      { id: "low", name: "Low" },
      { id: "medium", name: "Medium", recommended: true },
      { id: "xhigh", name: "Extra" },
    ]);
  });

  it("lit le cache du compte, et se rabat sur les alias sans lui", async () => {
    expect(await listModels(home)).toMatchObject({ source: "aliases" });

    const directory = join(home, "cache", "model-catalog");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "published-x.json"), "{}");
    await writeFile(
      join(directory, "compte-cc.json"),
      JSON.stringify({ catalog: { config: { models: [{ id: "claude-sonnet-5", name: "Sonnet 5", section: "main" }] } } }),
    );
    expect(await listModels(home)).toEqual({
      source: "catalog",
      models: [{ id: "claude-sonnet-5", name: "Sonnet 5", main: true, efforts: [] }],
    });
  });
});
