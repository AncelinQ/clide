import { describe, expect, it } from "vitest";

import { TicketTracker, ticketOfBranch } from "../src/work/tickets.js";

describe("ticketOfBranch", () => {
  it("lit l'identifiant porté par une branche", () => {
    expect(ticketOfBranch("ancelin/hn-12528-fe-us2-les-blocs")).toBe("HN-12528");
    expect(ticketOfBranch("aqn/feat/hn-13237-dnd")).toBe("HN-13237");
    expect(ticketOfBranch("aqn/feat/hn-13218-mar-468-evidence")).toBe("HN-13218");
  });

  it("ne voit pas de ticket là où il n'y en a pas", () => {
    expect(ticketOfBranch("main")).toBeUndefined();
    expect(ticketOfBranch("aqn/fix/tooltip-mode-invert")).toBeUndefined();
    expect(ticketOfBranch("ancelin/lot7-env-consolidation")).toBeUndefined();
    // Une date dans le nom de branche n'est pas un identifiant de ticket.
    expect(ticketOfBranch("aqn/chore/batch-2026-09-22")).toBeUndefined();
    expect(ticketOfBranch(undefined)).toBeUndefined();
  });
});

const call = (id: string, name: string, input: Record<string, unknown>, timestamp: string) => ({
  type: "assistant",
  timestamp,
  message: { content: [{ type: "tool_use", id, name, input }] },
});
const result = (id: string, payload: unknown, timestamp: string) => ({
  type: "user",
  timestamp,
  message: { content: [{ type: "tool_result", tool_use_id: id, content: [{ type: "text", text: JSON.stringify(payload) }] }] },
});

describe("TicketTracker", () => {
  it("tire titre, état et lien de la réponse de get_issue", () => {
    const tracker = new TicketTracker();
    tracker.apply(call("t1", "mcp__linear__get_issue", { id: "HN-12982" }, "2026-09-10T10:00:00Z"));
    tracker.apply(
      result("t1", { id: "HN-12982", title: "Textes EN", status: "Doing", url: "https://linear.app/x", gitBranchName: "aqn/hn-12982" }, "2026-09-10T10:00:01Z"),
    );
    expect(tracker.snapshot()["HN-12982"]).toEqual({
      title: "Textes EN",
      status: "Doing",
      statusAt: "2026-09-10T10:00:01Z",
      statusSetByClaude: false,
      url: "https://linear.app/x",
      gitBranch: "aqn/hn-12982",
    });
  });

  it("retient l'état fixé par save_issue quand il est le plus récent", () => {
    const tracker = new TicketTracker();
    tracker.apply(call("t1", "mcp__linear__get_issue", { id: "HN-1" }, "2026-09-10T10:00:00Z"));
    tracker.apply(result("t1", { id: "HN-1", status: "Doing" }, "2026-09-10T10:00:01Z"));
    tracker.apply(call("t2", "mcp__linear__save_issue", { id: "HN-1", state: "To merge" }, "2026-09-10T11:00:00Z"));
    expect(tracker.snapshot()["HN-1"]).toMatchObject({ status: "To merge", statusSetByClaude: true });
  });

  it("ignore un état désigné par son identifiant plutôt que par son nom", () => {
    const tracker = new TicketTracker();
    tracker.apply(
      call("t1", "mcp__linear__save_issue", { id: "HN-2", state: "4a19cea4-ef76-4d99-adf1-7125197fd0de" }, "2026-09-10T10:00:00Z"),
    );
    expect(tracker.snapshot()["HN-2"]?.status).toBeUndefined();
  });

  it("ne relève ni un identifiant mal formé ni un outil étranger à Linear", () => {
    const tracker = new TicketTracker();
    tracker.apply(call("t1", "mcp__linear__get_issue", { id: "pas-un-ticket" }, "2026-09-10T10:00:00Z"));
    tracker.apply(call("t2", "Read", { id: "HN-3" }, "2026-09-10T10:00:00Z"));
    expect(tracker.snapshot()).toEqual({});
  });
});
