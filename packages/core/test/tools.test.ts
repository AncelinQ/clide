import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { detectTools, makeTargets } from "../src/scripts/tools.js";

describe("makeTargets", () => {
  it("garde les cibles, dans l'ordre, sans affectations, cibles spéciales ni motifs", () => {
    const text = ["CC := gcc", ".PHONY: build test", "build: main.o", "\tgcc -o app main.o", "%.o: %.c", "test:", "build: other", "deploy/prod:"].join("\n");
    expect(makeTargets(text)).toEqual(["build", "test", "deploy/prod"]);
  });
});

describe("detectTools", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "clide-tools-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("ne trouve rien dans un dossier sans outil", async () => {
    expect(await detectTools(root)).toEqual([]);
  });

  it("reconnaît make, cargo, go, python et les scripts, chacun avec ses commandes", async () => {
    await writeFile(join(root, "Makefile"), "build:\n\techo ok\n");
    await writeFile(join(root, "Cargo.toml"), "[package]\n");
    await writeFile(join(root, "go.mod"), "module x\n");
    await writeFile(join(root, "pyproject.toml"), "[project]\n");
    await mkdir(join(root, "tests"));
    await mkdir(join(root, "scripts"));
    await writeFile(join(root, "scripts", "déployer l'app.ps1"), "");
    await writeFile(join(root, "setup.sh"), "");
    const tools = await detectTools(root);
    expect(tools.map((tool) => tool.tool)).toEqual(["make", "cargo", "go", "python", "powershell", "shell"]);
    expect(tools[0]?.commands).toEqual([{ name: "build", run: "make build" }]);
    expect(tools[3]?.commands).toEqual([{ name: "pytest", run: "python -m pytest" }]);
    // Une apostrophe dans le nom est doublée : la ligne reste une seule chaîne pour PowerShell.
    expect(tools[4]?.commands).toEqual([{ name: "scripts/déployer l'app.ps1", run: "& './scripts/déployer l''app.ps1'" }]);
    expect(tools[5]?.commands).toEqual([{ name: "setup.sh", run: "bash './setup.sh'" }]);
  });
});
