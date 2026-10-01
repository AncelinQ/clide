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

  it("compte chaque réponse une fois, même écrite en plusieurs events", () => {
    const usage = (input: number, output: number) => ({
      input_tokens: input,
      output_tokens: output,
      cache_read_input_tokens: 1000,
      cache_creation_input_tokens: 10,
    });
    const projection = projectEvents(SID, [
      // Deux blocs de la même réponse : même identifiant, même consommation.
      { type: "assistant", message: { id: "msg_1", model: "claude-opus-5-5", usage: usage(5, 40) } },
      { type: "assistant", message: { id: "msg_1", model: "claude-opus-5-5", usage: usage(5, 40) } },
      { type: "assistant", message: { id: "msg_2", model: "claude-opus-5-5", usage: usage(3, 60) } },
    ]);

    expect(projection.tokens).toEqual({
      input: 8,
      output: 100,
      cacheRead: 2000,
      cacheCreation: 20,
      context: 1013,
      byModel: { "claude-opus-5-5": { input: 8, output: 100, cacheRead: 2000, cacheCreation: 20 } },
    });
    expect(projection.model).toBe("claude-opus-5-5");
  });

  it("retient l'effort de la dernière réponse", () => {
    const answer = (id: string, effort?: string) => ({
      type: "assistant",
      ...(effort ? { effort } : {}),
      message: { id, model: "claude-opus-5-5", usage: { input_tokens: 1, output_tokens: 1 } },
    });
    expect(projectEvents(SID, [answer("m1", "high"), answer("m2", "xhigh")]).effort).toBe("xhigh");
    expect(projectEvents(SID, [answer("m1", "high"), answer("m2")]).effort).toBeUndefined();
  });

  it("suit un /effort avant la réponse suivante", () => {
    const answer = (id: string, effort: string) => ({
      type: "assistant",
      effort,
      message: { id, model: "claude-opus-5-5", usage: { input_tokens: 1, output_tokens: 1 } },
    });
    const stdout = {
      type: "user",
      message: {
        role: "user",
        content: "<local-command-stdout>Set effort level to xhigh (saved as your default for new sessions): Deeper reasoning</local-command-stdout>",
      },
    };
    expect(projectEvents(SID, [answer("m1", "medium"), stdout]).effort).toBe("xhigh");
    expect(projectEvents(SID, [answer("m1", "medium"), stdout, answer("m2", "low")]).effort).toBe("low");
  });

  it("suit un /model avant la réponse suivante", () => {
    const answer = { type: "assistant", message: { id: "m1", model: "claude-opus-5-5", usage: { input_tokens: 1, output_tokens: 1 } } };
    const say = (content: string) => ({ type: "user", message: { role: "user", content } });
    const command = (args: string) => say(`<command-name>/model</command-name>
<command-message>model</command-message>
<command-args>${args}</command-args>`);
    const done = say("<local-command-stdout>Set model to `Fable 5.1` and saved as your default for new sessions</local-command-stdout>");
    const model = (...events: TranscriptEvent[]) => projectEvents(SID, [answer, ...events]).model;
    expect(model(command("claude-fable-5-1"), done)).toBe("claude-fable-5-1");
    // Choisi dans le sélecteur : seul le nom affiché est connu.
    expect(model(command(""), done)).toBe("Fable 5.1");
    // Une commande refusée ne change rien.
    expect(model(command("inconnu"), say("<local-command-stdout>Model 'inconnu' not found</local-command-stdout>"))).toBe("claude-opus-5-5");
  });

  it("suit /model et /effort dans une session qui n'a pas encore de réponse", () => {
    const say = (content: string) => ({ type: "user", message: { role: "user", content } });
    const projection = projectEvents(SID, [
      say("<command-name>/model</command-name>\n<command-args>claude-opus-5-5</command-args>"),
      say("<local-command-stdout>Set model to `Opus 5.5` and saved as your default for new sessions</local-command-stdout>"),
      say("<local-command-stdout>Set effort level to xhigh (saved as your default for new sessions): Deeper reasoning</local-command-stdout>"),
    ]);
    expect(projection).toMatchObject({ model: "claude-opus-5-5", effort: "xhigh" });
    expect(projection.tokens).toBeUndefined();
  });

  it("sépare ce qui a été consommé après le dernier relevé de coût", () => {
    const answer = (id: string, output: number) => ({
      type: "assistant",
      message: { id, model: "claude-haiku-4-5", usage: { input_tokens: 1, output_tokens: output } },
    });
    const projection = projectEvents(SID, [
      answer("m1", 10),
      { type: "cost-state", totalCostUSD: 0.5 },
      // La même réponse réécrite après le relevé reste comptée par lui.
      answer("m1", 10),
      answer("m2", 7),
    ]);
    expect(projection.tokens?.afterCost).toEqual({
      "claude-haiku-4-5": { input: 1, output: 7, cacheRead: 0, cacheCreation: 0 },
    });
    expect(projection.tokens?.byModel["claude-haiku-4-5"]?.output).toBe(17);
  });

  it("ne signale rien après un relevé qui clôt la session", () => {
    const projection = projectEvents(SID, [
      { type: "assistant", message: { id: "m1", model: "x", usage: { input_tokens: 1, output_tokens: 1 } } },
      { type: "cost-state", totalCostUSD: 0.1 },
    ]);
    expect(projection.tokens?.afterCost).toBeUndefined();
  });

  it("n'invente pas de consommation sans réponse chiffrée", () => {
    expect(projectEvents(SID, [{ type: "assistant", message: { id: "msg_1" } }]).tokens).toBeUndefined();
  });

  it("suit l'entrée et la sortie du mode plan, par l'outil comme par la permission", () => {
    const tool = (name: string) => ({
      type: "assistant",
      message: { id: name, content: [{ type: "tool_use", name, input: {} }] },
    });

    expect(projectEvents(SID, [tool("EnterPlanMode")]).planMode).toBe(true);
    expect(projectEvents(SID, [tool("EnterPlanMode"), tool("ExitPlanMode")]).planMode).toBe(false);
    expect(projectEvents(SID, [{ type: "permission-mode", permissionMode: "plan" }]).planMode).toBe(true);
    expect(
      projectEvents(SID, [
        { type: "permission-mode", permissionMode: "plan" },
        { type: "permission-mode", permissionMode: "auto" },
      ]).planMode,
    ).toBe(false);
    expect(projectEvents(SID, [{ type: "mode", mode: "normal" }]).planMode).toBeUndefined();
  });

  it("lit le mode plan sur le prompt du tour, pas sur l'event de fin de tour", () => {
    // Ordre réel d'un transcript : l'event `permission-mode` du tour précédent,
    // puis le prompt envoyé en mode plan et la pièce jointe qui l'annonce.
    const projection = projectEvents(SID, [
      { type: "permission-mode", permissionMode: "auto" },
      { type: "user", permissionMode: "plan", message: { role: "user", content: "OK" } },
      {
        type: "attachment",
        attachment: { type: "plan_mode", planFilePath: "C:/Users/x/.claude/plans/ok.md", planExists: false },
      },
    ]);
    expect(projection.permissionMode).toBe("plan");
    expect(projection.planMode).toBe(true);
    expect(projection.planFilePath).toBe("C:/Users/x/.claude/plans/ok.md");
  });

  it("rejoue la file d'attente dans l'ordre où Claude la videra", () => {
    const op = (operation: string, content?: string) => ({
      type: "queue-operation",
      operation,
      ...(content ? { content } : {}),
    });
    const projection = projectEvents(SID, [
      op("enqueue", "premier"),
      op("enqueue", "deuxième"),
      op("enqueue", "troisième"),
      // Absorbé en cours de tour : retiré par son texte, où qu'il soit.
      op("remove", "deuxième"),
      // Pris par Claude : le premier sort.
      op("dequeue"),
      op("enqueue", "quatrième"),
    ]);
    expect(projection.queue.map((entry) => entry.text)).toEqual(["troisième", "quatrième"]);
    expect(projectEvents(SID, [op("enqueue", "a"), op("enqueue", "b"), op("popAll", "a")]).queue).toEqual([]);
  });
});

describe("écritures des commandes Bash", () => {
  const bashResult = (files: unknown[], timestamp?: string): TranscriptEvent => ({
    type: "user",
    ...(timestamp ? { timestamp } : {}),
    toolUseResult: { stdout: "", stderr: "", bashEditDiff: { files, moreFiles: 0, changedFiles: files.length } },
  });

  it("relève le diff que Claude Code joint au résultat d'une commande", () => {
    const projection = projectEvents(SID, [
      bashResult(
        [
          {
            filePath: "C:\\Projets\\app\\src\\a.ts",
            hunks: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 3, lines: [" a", "+b", " c"] }],
          },
        ],
        "2026-09-28T10:00:00.000Z",
      ),
    ]);
    expect(projection.bashEdits).toEqual([
      {
        path: "C:\\Projets\\app\\src\\a.ts",
        hunks: ["@@ -1,2 +1,3 @@\n a\n+b\n c"],
        at: "2026-09-28T10:00:00.000Z",
      },
    ]);
  });

  it("cumule les morceaux d'un même fichier, commande après commande", () => {
    const hunk = { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-x", "+y"] };
    const projection = projectEvents(SID, [
      bashResult([{ filePath: "C:\\a.ts", hunks: [hunk] }], "2026-09-28T10:00:00.000Z"),
      bashResult([{ filePath: "C:\\a.ts", hunks: [hunk] }], "2026-09-28T10:05:00.000Z"),
    ]);
    expect(projection.bashEdits).toHaveLength(1);
    expect(projection.bashEdits[0]?.hunks).toHaveLength(2);
    expect(projection.bashEdits[0]?.at).toBe("2026-09-28T10:05:00.000Z");
  });

  it("ignore un résultat sans diff, ou mal formé", () => {
    const projection = projectEvents(SID, [
      { type: "user", toolUseResult: { stdout: "ok" } },
      bashResult([{ filePath: "", hunks: [] }, { hunks: "non" }, "rien"]),
      { type: "user", toolUseResult: "texte" },
    ]);
    expect(projection.bashEdits).toEqual([]);
  });
});
