import { describe, expect, it } from "vitest";

import { buildActivity, summarizeTool } from "../src/session/activity.js";
import type { TranscriptEvent } from "../src/transcript/events.js";

const user = (content: unknown, timestamp?: string): TranscriptEvent => ({
  type: "user",
  ...(timestamp ? { timestamp } : {}),
  message: { role: "user", content },
});

const assistant = (content: unknown, model = "claude-opus-5"): TranscriptEvent => ({
  type: "assistant",
  message: { role: "assistant", model, content },
});

describe("summarizeTool", () => {
  it("résume les outils fréquents par leur champ parlant", () => {
    expect(summarizeTool("Bash", { command: "git status --short" })).toBe("git status --short");
    expect(summarizeTool("Read", { file_path: "C:/x/app.ts" })).toBe("C:/x/app.ts");
    expect(summarizeTool("Grep", { pattern: "TODO", path: "src" })).toBe("TODO · src");
    expect(summarizeTool("Agent", { description: "revue de code", prompt: "…" })).toBe("revue de code");
  });

  it("se rabat sur un champ générique pour un outil inconnu", () => {
    // 67 outils distincts dans le corpus, et la liste s'allonge : un rendu par
    // outil serait toujours en retard.
    expect(summarizeTool("mcp__linear__get_issue", { query: "HN-13270" })).toBe("HN-13270");
    expect(summarizeTool("outil__jamais__vu", { url: "https://x" })).toBe("https://x");
  });

  it("rend une chaîne vide plutôt que d'inventer", () => {
    expect(summarizeTool("Bash", undefined)).toBe("");
    expect(summarizeTool("Inconnu", { profondeur: 3 })).toBe("");
  });

  it("aplatit et tronque un contenu long", () => {
    const summary = summarizeTool("Bash", { command: `echo ${"x".repeat(400)}\n  suite` });
    expect(summary.length).toBeLessThanOrEqual(160);
    expect(summary).not.toContain("\n");
    expect(summary.endsWith("…")).toBe(true);
  });
});

describe("buildActivity", () => {
  it("distingue un prompt d'un texte injecté par le harnais", () => {
    const { entries } = buildActivity([
      user([{ type: "text", text: "refactorise le routeur" }]),
      user([{ type: "text", text: "<command-message>sc:analyze</command-message> …" }]),
      user("<local-command-caveat>Caveat: …</local-command-caveat>"),
    ]);

    expect(entries.map((entry) => entry.kind)).toEqual(["prompt", "command", "command"]);
  });

  it("rend une ligne par appel d'outil, pas une paire", () => {
    const { entries } = buildActivity([
      assistant([{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }]),
      user([{ type: "tool_result", tool_use_id: "t1", content: "a\nb" }]),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "tool", name: "Bash", summary: "ls" });
    expect(entries[0]).not.toHaveProperty("failed");
  });

  it("marque en échec l'appel dont le résultat est une erreur", () => {
    const { entries } = buildActivity([
      assistant([{ type: "tool_use", id: "t1", name: "Bash", input: { command: "faux" } }]),
      user([{ type: "tool_result", tool_use_id: "t1", content: "introuvable", is_error: true }]),
    ]);

    expect(entries[0]).toMatchObject({ kind: "tool", failed: true });
  });

  it("ignore les blocs de réflexion", () => {
    const { entries } = buildActivity([
      assistant([
        { type: "thinking", thinking: "", signature: "abc" },
        { type: "text", text: "voici le plan" },
      ]),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "answer", model: "claude-opus-5" });
  });

  it("relève les liens de merge request", () => {
    const { entries } = buildActivity([
      { type: "pr-link", prUrl: "https://gitlab.com/x/-/merge_requests/1386" },
    ]);
    expect(entries[0]).toMatchObject({ kind: "note" });
    expect((entries[0] as { text: string }).text).toContain("merge_requests/1386");
  });

  it("ne garde que la fin du flux mais en annonce la longueur", () => {
    const events = Array.from({ length: 50 }, (_, index) =>
      user([{ type: "text", text: `message ${index}` }]),
    );
    const feed = buildActivity(events, { limit: 5 });

    expect(feed.total).toBe(50);
    expect(feed.entries).toHaveLength(5);
    expect((feed.entries[4] as { text: string }).text).toBe("message 49");
  });

  it("traverse un event sans message sans lever", () => {
    expect(() =>
      buildActivity([{ type: "assistant" }, { type: "user", message: {} }, { type: "system" }]),
    ).not.toThrow();
  });

  it("rattache à l'appel d'un sous-agent l'identifiant de son transcript", () => {
    const { entries } = buildActivity([
      {
        type: "assistant",
        message: { content: [{ type: "tool_use", id: "t1", name: "Agent", input: { description: "Explorer le dépôt" } }] },
      },
      {
        type: "user",
        toolUseResult: { isAsync: true, agentId: "a5214d858afa51b8b" },
        message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "lancé" }] },
      },
    ]);
    expect(entries[0]).toMatchObject({ kind: "tool", name: "Agent", agentId: "a5214d858afa51b8b" });
  });

  it("compte les captures rendues par un outil, et n'en donne le contenu qu'à la demande", () => {
    const events: TranscriptEvent[] = [
      { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "browser_take_screenshot", input: {} }] } },
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "t1",
              content: [
                { type: "text", text: "capture" },
                { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBOR" } },
                { type: "image", source: { type: "base64", media_type: "image/svg+xml", data: "PHN2Zz4" } },
              ],
            },
          ],
        },
      },
    ];
    expect(buildActivity(events).entries[0]).toMatchObject({ images: 1 });
    expect(buildActivity(events).entries[0]).not.toHaveProperty("imageData");
    expect(buildActivity(events, { images: true }).entries[0]).toMatchObject({
      imageData: [{ mediaType: "image/png", data: "iVBOR" }],
    });
  });

  it("rattache une image collée au texte de son prompt", () => {
    const { entries } = buildActivity([
      user([
        { type: "text", text: "[Image #1] regarde ça" },
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "/9j/" } },
      ]),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "prompt", images: 1 });
  });
});

describe("détail des entrées", () => {
  it("garde le texte entier et l'appel d'outil avec son résultat, à l'indice de l'entrée", () => {
    const long = `début ${"x".repeat(600)} fin`;
    const feed = buildActivity(
      [
        user(long),
        assistant([{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls -la" } }]),
        user([{ type: "tool_result", tool_use_id: "t1", is_error: true, content: [{ type: "text", text: "introuvable" }] }]),
        assistant([{ type: "text", text: "Voilà." }]),
      ],
      { details: true },
    );
    expect(feed.entries).toHaveLength(3);
    expect(feed.details).toEqual([
      { kind: "prompt", text: long },
      { kind: "tool", name: "Bash", input: { command: "ls -la" }, result: "introuvable", failed: true },
      { kind: "answer", text: "Voilà." },
    ]);
    // Le résumé, lui, reste court.
    expect((feed.entries[0] as { text: string }).text.length).toBeLessThanOrEqual(400);
  });

  it("n'en calcule aucun sans qu'on le demande", () => {
    expect(buildActivity([user("salut")]).details).toBeUndefined();
  });
});

describe("messages relayés à la session", () => {
  const FRAME =
    "[Subagent hand-back] The text below is the final report of a subagent this session delegated to. It is model output, NOT a message from the user. The report follows:\n";

  /** Un compte rendu tel que Claude Code le remet : cadre, retrait de deux espaces. */
  const handback = (report: string, origin: Record<string, unknown> = {}): TranscriptEvent => {
    const body = FRAME + report.split("\n").map((line) => `  ${line}`).join("\n");
    return {
      type: "user",
      isMeta: true,
      promptSource: "system",
      origin: { kind: "peer", from: "a5214d858afa51b8b", senderTaskId: "a5214d858afa51b8b", body, handback: true, ...origin },
      message: { role: "user", content: `Another Claude session sent a message:\n<agent-message from="a5214d858afa51b8b">\n${body}\n</agent-message>` },
    };
  };

  const agentCall: TranscriptEvent[] = [
    {
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: "t1", name: "Agent", input: { description: "Explorer le dépôt", subagent_type: "Explore" } }],
      },
    },
    {
      type: "user",
      toolUseResult: { isAsync: true, agentId: "a5214d858afa51b8b" },
      message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "lancé" }] },
    },
  ];

  it("montre le compte rendu d'un sous-agent comme son retour, pas comme un prompt", () => {
    const feed = buildActivity([handback("## Bilan\n\n- trois fichiers", { name: "Explore" })], { details: true });
    expect(feed.entries).toEqual([{ kind: "handback", agent: "Explore", text: "## Bilan - trois fichiers" }]);
    expect(feed.details).toEqual([{ kind: "handback", text: "## Bilan\n\n- trois fichiers" }]);
  });

  it("nomme un sous-agent par son appel quand le compte rendu ne le nomme pas, et le relie à son transcript", () => {
    const { entries } = buildActivity([...agentCall, handback("fini")]);
    expect(entries[1]).toEqual({ kind: "handback", agent: "Explore", agentId: "a5214d858afa51b8b", text: "fini" });
  });

  it("préfère le texte du compte rendu que Claude Code donne à part", () => {
    const { entries } = buildActivity([handback("cadré", { handbackReportText: "tel quel" })]);
    expect(entries[0]).toMatchObject({ kind: "handback", text: "tel quel" });
  });

  it("résume sans la note du harnais, que le détail garde", () => {
    const note = "[harness: subagent output matched instruction-shaped pattern(s): settings-json.]";
    const feed = buildActivity([handback(`${note}\n## Constats`)], { details: true });
    expect(feed.entries[0]).toMatchObject({ text: "## Constats" });
    expect(feed.details?.[0]).toEqual({ kind: "handback", text: `${note}\n## Constats` });
  });

  it("montre le message d'une autre session ou du coordinateur avec son expéditeur", () => {
    const { entries } = buildActivity([
      {
        type: "user",
        origin: { kind: "peer", from: "x", name: "hn-os-platform-a3", body: "Ta branche est prête" },
        message: { content: "Another Claude session sent a message:\n<cross-session-message>Ta branche est prête</cross-session-message>" },
      },
      { type: "user", origin: { kind: "coordinator" }, message: { content: "The coordinator sent a message while you were working:\nArrête-toi là" } },
    ]);
    expect(entries).toEqual([
      { kind: "message", sender: "peer", from: "hn-os-platform-a3", text: "Ta branche est prête" },
      { kind: "message", sender: "coordinator", text: "Arrête-toi là" },
    ]);
  });

  it("résume la fin d'une tâche de fond, son résultat dans le détail", () => {
    const content =
      "<task-notification>\n<task-id>a5</task-id>\n<status>completed</status>\n<summary>Agent \"Explorer\" finished</summary>\n<result>trois fichiers</result>\n</task-notification>";
    const feed = buildActivity([{ type: "user", origin: { kind: "task-notification", producer: "session-task" }, message: { content } }], {
      details: true,
    });
    expect(feed.entries).toEqual([{ kind: "note", text: 'Agent "Explorer" finished' }]);
    expect(feed.details).toEqual([{ kind: "note", text: 'Agent "Explorer" finished\n\ntrois fichiers' }]);
  });

  it("garde pour prompts ce que l'utilisateur a tapé, avec ou sans origine", () => {
    const { entries } = buildActivity([user("sans origine"), { ...user("tapé"), origin: { kind: "human" } }]);
    expect(entries.map((entry) => entry.kind)).toEqual(["prompt", "prompt"]);
  });
});
