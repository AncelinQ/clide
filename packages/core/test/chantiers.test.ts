import { describe, expect, it } from "vitest";

import type { IndexedSession } from "../src/session/session-index.js";
import { buildChantiers } from "../src/work/chantiers.js";

const session = (id: string, extra: Partial<IndexedSession>): IndexedSession => ({
  sessionId: id,
  projectDir: "C--Projets-app",
  kind: "session",
  path: `${id}.jsonl`,
  size: 1,
  mtimeMs: 1,
  messageCount: 1,
  eventCount: 1,
  fileCount: 0,
  prLinks: [],
  unknownTypes: {},
  ...extra,
});

describe("buildChantiers", () => {
  it("rassemble sous un ticket sa branche, son worktree, ses MR et ses sessions", () => {
    const [chantier] = buildChantiers([
      session("a", {
        gitBranch: "ancelin/hn-12528-blocs",
        worktreePath: "C:/wt/hn-12528",
        prLinks: [{ prUrl: "https://gitlab/mr/42", prNumber: 42 }],
        lastActivityAt: "2026-09-20T10:00:00Z",
      }),
      session("b", {
        gitBranch: "main",
        lastActivityAt: "2026-09-21T10:00:00Z",
        tickets: { "HN-12528": { title: "Blocs", status: "To merge", statusAt: "2026-09-21T10:00:00Z", statusSetByClaude: true } },
        // Une MR ouverte par une session qui ne fait que consulter le ticket n'est pas la sienne.
        prLinks: [{ prUrl: "https://gitlab/mr/99", prNumber: 99 }],
      }),
    ]);
    expect(chantier).toMatchObject({
      key: "HN-12528",
      kind: "ticket",
      title: "Blocs",
      status: "To merge",
      statusSessionId: "b",
      branches: ["ancelin/hn-12528-blocs"],
      worktrees: ["C:/wt/hn-12528"],
      lastActivityAt: "2026-09-21T10:00:00Z",
    });
    expect(chantier?.mrs.map((mr) => mr.prNumber)).toEqual([42]);
    expect(chantier?.sessions.map((entry) => [entry.sessionId, entry.relation])).toEqual([
      ["b", "consultée"],
      ["a", "travaillée"],
    ]);
  });

  it("fait d'une branche sans ticket son propre chantier, jamais du tronc", () => {
    const chantiers = buildChantiers([
      session("a", { gitBranch: "aqn/fix/tooltip-mode-invert" }),
      session("b", { gitBranch: "main" }),
      session("c", { gitBranch: "HEAD" }),
    ]);
    expect(chantiers.map((chantier) => [chantier.key, chantier.kind])).toEqual([["aqn/fix/tooltip-mode-invert", "branche"]]);
  });

  it("garde l'état le plus récent quand plusieurs sessions ont vu le ticket", () => {
    const [chantier] = buildChantiers([
      session("récente", { tickets: { "HN-1": { status: "Done", statusAt: "2026-09-22T10:00:00Z" } } }),
      session("ancienne", { tickets: { "HN-1": { status: "Doing", statusAt: "2026-09-01T10:00:00Z" } } }),
    ]);
    expect(chantier).toMatchObject({ status: "Done", statusSessionId: "récente" });
  });
});
