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
});
