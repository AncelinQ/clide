import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { routes, type ApiContext } from "../src/api/routes.js";

const ID = "11111111-2222-3333-4444-555555555555";

describe("/api/session/transcript", () => {
  let home: string;
  let previous: string | undefined;
  let refreshed = 0;
  const context = {
    index: {
      list: () => (refreshed > 0 ? [{ sessionId: ID, projectDir: "C--p" }] : []),
      refresh: async () => {
        refreshed++;
      },
    },
  } as unknown as ApiContext;

  beforeAll(async () => {
    // Un dossier Claude jetable : jamais celui de l'utilisateur.
    home = await mkdtemp(join(tmpdir(), "clide-transcript-"));
    previous = process.env["CLAUDE_CONFIG_DIR"];
    process.env["CLAUDE_CONFIG_DIR"] = home;
    await mkdir(join(home, "projects", "C--p"), { recursive: true });
    await writeFile(join(home, "projects", "C--p", `${ID}.jsonl`), '{"type":"user"}\n{"type":"assistant"}\n');
  });

  afterAll(async () => {
    if (previous === undefined) delete process.env["CLAUDE_CONFIG_DIR"];
    else process.env["CLAUDE_CONFIG_DIR"] = previous;
    await rm(home, { recursive: true, force: true });
  });

  it("rend le transcript d'une session, en relisant l'index s'il ne la connaît pas encore", async () => {
    const answer = (await routes["/api/session/transcript"]?.(new URLSearchParams({ id: ID }), context)) as { text: string; truncated: boolean; path: string };
    expect(refreshed).toBe(1);
    expect(answer.text).toBe('{"type":"user"}\n{"type":"assistant"}\n');
    expect(answer.truncated).toBe(false);
    expect(answer.path).toBe(join(home, "projects", "C--p", `${ID}.jsonl`));
  });

  it("refuse une session inconnue", async () => {
    await expect(routes["/api/session/transcript"]?.(new URLSearchParams({ id: "22222222-2222-3333-4444-555555555555" }), context)).rejects.toThrow("introuvable");
  });
});
