import { describe, expect, it } from "vitest";

import { SessionProjector, projectEvents } from "../src/session/projection.js";
import type { TranscriptEvent } from "../src/transcript/events.js";

const SID = "0350d6a5-5bec-4df4-ba51-45df51df60f7";

describe("SessionProjector", () => {
  it("garde la dernière valeur des champs scalaires", () => {
    const projection = projectEvents(SID, [
      { type: "mode", mode: "normal" },
      { type: "ai-title", aiTitle: "premier titre" },
      { type: "mode", mode: "plan" },
      { type: "ai-title", aiTitle: "titre courant" },
    ]);

    expect(projection.mode).toBe("plan");
    expect(projection.title).toBe("titre courant");
  });

  it("date le début sur le premier horodatage et l'activité sur le dernier", () => {
    const projection = projectEvents(SID, [
      { type: "user", timestamp: "2026-08-31T07:35:51.674Z" },
      { type: "assistant", timestamp: "2026-08-31T09:02:00.000Z" },
    ]);

    expect(projection.startedAt).toBe("2026-08-31T07:35:51.674Z");
    expect(projection.lastActivityAt).toBe("2026-08-31T09:02:00.000Z");
    expect(projection.messageCount).toBe(2);
  });

  it("suit la session dans son worktree plutôt que dans son dossier d'origine", () => {
    const projector = new SessionProjector(SID);
    projector.apply({ type: "user", cwd: "C:\\Projets\\mon-app" });
    expect(projector.effectiveCwd).toBe("C:\\Projets\\mon-app");

    projector.apply({
      type: "relocated",
      relocatedCwd: "C:\\Projets\\mon-app\\.claude\\worktrees\\chantier-a",
    });

    expect(projector.effectiveCwd).toBe(
      "C:\\Projets\\mon-app\\.claude\\worktrees\\chantier-a",
    );
    // Le dossier de départ reste disponible, il n'est pas écrasé.
    expect(projector.snapshot().cwd).toBe("C:\\Projets\\mon-app");
  });

  it("retient le worktree et son dossier d'origine", () => {
    const projection = projectEvents(SID, [
      {
        type: "worktree-state",
        worktreeSession: {
          originalCwd: "C:\\Projets\\mon-app",
          worktreePath: "C:\\Projets\\mon-app\\.claude\\worktrees\\wt",
        },
      },
    ]);

    expect(projection.worktreePath).toBe("C:\\Projets\\mon-app\\.claude\\worktrees\\wt");
    expect(projection.originalCwd).toBe("C:\\Projets\\mon-app");
  });

  it("expose la session qui prend la suite", () => {
    const projection = projectEvents(SID, [
      { type: "continued-in", continuedInSessionId: "676a9362-d3d2-42b1-a0fc-48f91ada33aa" },
    ]);

    expect(projection.continuedInSessionId).toBe("676a9362-d3d2-42b1-a0fc-48f91ada33aa");
  });

  it("accumule les fichiers touchés et trie leurs sauvegardes par version", () => {
    const projection = projectEvents(SID, [
      {
        type: "file-history-delta",
        trackingPath: "src\\pages\\routes.ts",
        backup: { backupFileName: "50edda73d8fecd1b@v2", version: 2 },
      },
      {
        type: "file-history-delta",
        trackingPath: "src\\pages\\routes.ts",
        backup: { backupFileName: "50edda73d8fecd1b@v1", version: 1 },
      },
      {
        type: "file-history-delta",
        trackingPath: "src\\app.ts",
        backup: { backupFileName: "f070e7ad1c13998e@v1", version: 1 },
      },
    ]);

    expect(projection.files).toHaveLength(2);
    const routes = projection.files.find((f) => f.trackingPath === "src\\pages\\routes.ts");
    expect(routes?.backups.map((b) => b.version)).toEqual([1, 2]);
  });

  it("suit un fichier créé, qui n'a aucune sauvegarde à nommer", () => {
    const projection = projectEvents(SID, [
      {
        type: "file-history-delta",
        trackingPath: "claudedocs\\nouveau.md",
        backup: {
          backupFileName: null,
          version: 1,
          backupTime: "2026-09-22T10:15:00.154Z",
          realParentDir: "C:\\Projets\\claudedocs",
        },
      },
    ]);

    const track = projection.files[0];
    expect(track?.trackingPath).toBe("claudedocs\\nouveau.md");
    expect(track?.created).toBe(true);
    expect(track?.backups[0]?.backupFileName).toBeNull();
    expect(track?.backups[0]?.realParentDir).toBe("C:\\Projets\\claudedocs");
  });

  it("distingue un fichier modifié d'un fichier créé", () => {
    const projection = projectEvents(SID, [
      {
        type: "file-history-delta",
        trackingPath: "src\\app.ts",
        backup: { backupFileName: "f070e7ad1c13998e@v1", version: 1 },
      },
    ]);

    expect(projection.files[0]?.created).toBe(false);
  });

  it("ne duplique pas une même sauvegarde relue", () => {
    const delta: TranscriptEvent = {
      type: "file-history-delta",
      trackingPath: "src\\app.ts",
      backup: { backupFileName: "f070e7ad1c13998e@v1", version: 1 },
    };
    const projection = projectEvents(SID, [delta, delta]);
    expect(projection.files[0]?.backups).toHaveLength(1);
  });

  it("collecte les liens de merge request sans doublon", () => {
    const projection = projectEvents(SID, [
      { type: "pr-link", prNumber: 1386, prUrl: "https://gitlab.com/x/-/merge_requests/1386" },
      { type: "pr-link", prNumber: 1386, prUrl: "https://gitlab.com/x/-/merge_requests/1386" },
    ]);

    expect(projection.prLinks).toHaveLength(1);
    expect(projection.prLinks[0]?.prNumber).toBe(1386);
  });

  it("compte les types inconnus au lieu d'échouer", () => {
    const projection = projectEvents(SID, [
      { type: "user" },
      { type: "type-invente-par-une-version-future" },
      { type: "type-invente-par-une-version-future" },
    ]);

    expect(projection.unknownTypes).toEqual({ "type-invente-par-une-version-future": 2 });
    expect(projection.eventCount).toBe(3);
  });

  it("ignore un event connu dont la charge utile est absente", () => {
    const projection = projectEvents(SID, [
      { type: "ai-title" },
      { type: "cost-state" },
      { type: "file-history-delta", trackingPath: "src\\app.ts" },
    ]);

    expect(projection.title).toBeUndefined();
    expect(projection.cost).toBeUndefined();
    expect(projection.files).toHaveLength(0);
    expect(projection.unknownTypes).toEqual({});
  });
});
