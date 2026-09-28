import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApiContext } from "../src/api/routes.js";
import { prompts } from "../src/modules/prompts.js";

describe("module prompts", () => {
  let dir: string;
  let context: ApiContext;
  const now = new Date().toISOString();
  const typed = (command: string) => ({ text: `<command-name>${command}</command-name>`, at: now });

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "clide-prompts-srv-"));
    context = {
      dataDir: dir,
      search: {
        refresh: async () => ({ reindexed: 0, reused: 0 }),
        save: async () => undefined,
        *commands() {
          for (let index = 0; index < 4; index++) yield typed("/sc:brainstorm");
          for (let index = 0; index < 3; index++) yield typed("/sc:analyze");
          for (let index = 0; index < 5; index++) yield typed("/clear");
        },
      },
    } as unknown as ApiContext;
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const route = (path: string) => prompts.routes?.[path] as (params: URLSearchParams, context: ApiContext) => Promise<unknown>;
  const mutation = (path: string) =>
    prompts.mutations?.[path] as (params: URLSearchParams, context: ApiContext, body: Record<string, unknown>) => Promise<unknown>;

  it("enregistre, liste et retire un prompt", async () => {
    const { prompt } = (await mutation("/api/prompts/save")(new URLSearchParams(), context, {
      prompt: { label: "Brainstorm", text: "/sc:brainstorm {saisie}", mode: "insert", scope: "user" },
    })) as { prompt: { id: string } };
    const listed = (await route("/api/prompts")(new URLSearchParams(), context)) as { prompts: { label: string; mode: string }[] };
    expect(listed.prompts).toEqual([expect.objectContaining({ label: "Brainstorm", mode: "insert", scope: "user" })]);

    const { suggestions } = (await route("/api/prompts/suggestions")(new URLSearchParams(), context)) as {
      suggestions: { command: string }[];
    };
    // /sc:brainstorm est déjà enregistré, /clear est une commande de Claude Code : seule /sc:analyze est proposée.
    expect(suggestions.map((item) => item.command)).toEqual(["/sc:analyze"]);

    await mutation("/api/prompts/remove")(new URLSearchParams(), context, { id: prompt.id, scope: "user" });
    expect(((await route("/api/prompts")(new URLSearchParams(), context)) as { prompts: unknown[] }).prompts).toEqual([]);
  });
});
