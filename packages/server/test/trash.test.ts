import { describe, expect, it } from "vitest";

import { trashScript } from "../src/platform/trash.js";

describe("trashScript", () => {
  const script = trashScript();

  it("envoie à la corbeille, jamais en suppression définitive", () => {
    expect(script.match(/SendToRecycleBin/g)).toHaveLength(2);
    expect(script).not.toMatch(/DeletePermanently|Remove-Item/);
  });

  it("reçoit les chemins en arguments, lus tels quels", () => {
    expect(script).toContain("ValueFromRemainingArguments");
    expect(script).toContain("-LiteralPath $path");
  });
});
