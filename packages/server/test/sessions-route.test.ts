import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { routes, type ApiContext } from "../src/api/routes.js";
import { SessionNames } from "../src/sessions/names.js";

describe("/api/sessions", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "clide-sessions-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  });

  it("joint à chaque session le nom de l'onglet où elle a tourné", async () => {
    const names = new SessionNames(join(directory, "session-names.json"));
    names.set("nommee", "revue");
    const context = {
      index: {
        list: () => [
          { sessionId: "nommee", projectDir: "C--p", messageCount: 1, fileCount: 0, prLinks: [] },
          { sessionId: "anonyme", projectDir: "C--p", messageCount: 1, fileCount: 0, prLinks: [] },
        ],
        refresh: async () => {},
        save: async () => {},
        subagents: () => [],
      },
      names,
    } as unknown as ApiContext;

    const { sessions } = (await routes["/api/sessions"]?.(new URLSearchParams(), context)) as {
      sessions: { sessionId: string; tabName?: string }[];
    };
    expect(sessions.find((session) => session.sessionId === "nommee")?.tabName).toBe("revue");
    expect(sessions.find((session) => session.sessionId === "anonyme")).not.toHaveProperty("tabName");
    await names.flush();
  });
});
