import { describe, expect, it } from "vitest";

import { statusErrorText, statusLabel, statusTone } from "../src/lib/claude-info";

describe("statusTone", () => {
  it("distingue le bon fonctionnement, la gêne et la panne", () => {
    expect(statusTone("none")).toBe("ok");
    expect(statusTone("minor")).toBe("warn");
    expect(statusTone("maintenance")).toBe("warn");
    expect(statusTone("major")).toBe("error");
    expect(statusTone("critical")).toBe("error");
  });

  it("prend un état inconnu pour une panne plutôt que pour un bon fonctionnement", () => {
    expect(statusTone("nouveau")).toBe("error");
  });
});

describe("statusLabel", () => {
  it("nomme les états des composants et des incidents", () => {
    expect(statusLabel("degraded_performance")).toBe("ralenti");
    expect(statusLabel("major_outage")).toBe("panne majeure");
    expect(statusLabel("identified")).toBe("cause identifiée");
  });

  it("garde lisible un état qu'il ne connaît pas", () => {
    expect(statusLabel("partially_restored")).toBe("partially restored");
  });
});

describe("statusErrorText", () => {
  it("sépare le code réseau du texte à traduire", () => {
    expect(statusErrorText("réseau injoignable (ENOTFOUND)")).toEqual({
      text: "réseau injoignable ({code})",
      values: { code: "ENOTFOUND" },
    });
  });

  it("rend les autres raisons telles quelles", () => {
    expect(statusErrorText("délai dépassé")).toEqual({ text: "délai dépassé", values: {} });
    expect(statusErrorText("HTTP 503")).toEqual({ text: "HTTP 503", values: {} });
  });
});
