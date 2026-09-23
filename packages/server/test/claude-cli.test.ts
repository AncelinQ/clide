import { describe, expect, it } from "vitest";

import { addJsonArgs, removeArgs } from "../src/platform/claude-cli.js";

describe("arguments de claude mcp", () => {
  it("passe toute la configuration en un seul argument JSON", () => {
    const config = { command: "npx", args: ["-y", "mon paquet"], env: { TOKEN: "a b & c" } };
    const args = addJsonArgs("user", "outil", config);
    expect(args).toEqual(["mcp", "add-json", "-s", "user", "outil", JSON.stringify(config)]);
    // Un seul élément porte les valeurs saisies : rien ne les découpe ni ne les relit.
    expect(args.filter((arg) => arg.includes("a b & c"))).toHaveLength(1);
  });

  it("retire dans la portée demandée", () => {
    expect(removeArgs("local", "outil")).toEqual(["mcp", "remove", "-s", "local", "outil"]);
  });
});
