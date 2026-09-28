import { describe, expect, it } from "vitest";

import { terminalOf, type TerminalLookup } from "../src/notifications/target.js";
import type { TerminalInfo } from "../src/pty/manager.js";
import type { ClaudeNotification } from "../src/notifications/watcher.js";

const tab = (id: string, cwd: string): TerminalInfo => ({
  id,
  kind: "claude",
  projectRoot: cwd,
  cwd,
  title: id,
  state: "idle",
  exited: false,
});

/** Deux onglets Claude dans le même dossier, un troisième ailleurs. */
const lookup: TerminalLookup = {
  get: (id) => ({ a: tab("a", "C:/app"), b: tab("b", "C:/app"), c: tab("c", "C:/autre") })[id],
  findByCwd: (path) => (path === "C:/app" ? tab("a", "C:/app") : path === "C:/autre" ? tab("c", "C:/autre") : undefined),
};

const event = (extra: Partial<ClaudeNotification>): ClaudeNotification => ({
  id: "1",
  kind: "session",
  receivedAt: "2026-09-28T10:00:00.000Z",
  ...extra,
});

describe("terminalOf", () => {
  it("préfère l'onglet nommé au dossier : deux onglets du même dossier ne se confondent pas", () => {
    expect(terminalOf(lookup, event({ terminalId: "b", cwd: "C:/app" }))?.id).toBe("b");
  });

  it("retombe sur le dossier quand l'événement ne nomme aucun onglet", () => {
    expect(terminalOf(lookup, event({ cwd: "C:/autre" }))?.id).toBe("c");
  });

  it("ignore un onglet fermé entre-temps et retombe sur le dossier", () => {
    expect(terminalOf(lookup, event({ terminalId: "fermé", cwd: "C:/app" }))?.id).toBe("a");
  });

  it("ne rattache rien sans onglet ni dossier connu", () => {
    expect(terminalOf(lookup, event({ terminalId: "fermé", cwd: "C:/inconnu" }))).toBeUndefined();
    expect(terminalOf(lookup, event({}))).toBeUndefined();
  });
});
