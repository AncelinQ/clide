import { describe, expect, it } from "vitest";

import {
  ProcessLister,
  buildProcessTree,
  flatten,
  isClaudeProcess,
  parseProcessList,
  type RawProcess,
} from "../src/platform/processes.js";

const process_ = (pid: number, parentPid: number, name: string, commandLine?: string): RawProcess => ({
  pid,
  parentPid,
  name,
  ...(commandLine ? { commandLine } : {}),
  memoryMB: 1,
});

describe("parseProcessList", () => {
  it("lit la sortie de ConvertTo-Json", () => {
    const json = JSON.stringify([
      {
        ProcessId: 42,
        ParentProcessId: 7,
        Name: "claude.exe",
        CommandLine: "claude.exe",
        StartedAt: "2026-09-22T09:13:39.876789+02:00",
        MemoryMB: 246.1,
      },
    ]);
    expect(parseProcessList(json)).toEqual([
      {
        pid: 42,
        parentPid: 7,
        name: "claude.exe",
        commandLine: "claude.exe",
        startedAt: "2026-09-22T09:13:39.876789+02:00",
        memoryMB: 246.1,
      },
    ]);
  });

  it("accepte un objet seul, que PowerShell rend pour un résultat unique", () => {
    const json = JSON.stringify({ ProcessId: 1, ParentProcessId: 0, Name: "claude.exe", MemoryMB: 2 });
    expect(parseProcessList(json)).toHaveLength(1);
  });

  it("ignore une sortie vide ou illisible", () => {
    expect(parseProcessList("")).toEqual([]);
    expect(parseProcessList("pas du json")).toEqual([]);
  });
});

describe("isClaudeProcess", () => {
  it("reconnaît l'exécutable et le lancement par node", () => {
    expect(isClaudeProcess(process_(1, 0, "claude.exe"))).toBe(true);
    expect(isClaudeProcess(process_(2, 0, "node.exe", 'node.exe "C:/x/bin/claude.js" --resume'))).toBe(true);
  });

  it("ne confond pas un node quelconque avec Claude", () => {
    expect(isClaudeProcess(process_(3, 0, "node.exe", "node.exe vite.js"))).toBe(false);
    expect(isClaudeProcess(process_(4, 0, "pwsh.exe"))).toBe(false);
  });
});

describe("buildProcessTree", () => {
  const scene: RawProcess[] = [
    process_(100, 1, "pwsh.exe"), // terminal ouvert par l'application
    process_(200, 100, "claude.exe"),
    process_(300, 200, "node.exe", "node.exe tsc.js"),
    process_(400, 1, "claude.exe"), // lancé ailleurs
    process_(500, 400, "git.exe"),
    process_(600, 1, "explorer.exe"),
  ];

  it("rattache avec certitude ce qui descend d'un terminal ouvert ici", () => {
    const tree = buildProcessTree(scene, new Map([[100, "terminal-a"]]));
    const owned = tree.find((node) => node.pid === 200);

    expect(owned?.link).toEqual({ kind: "owned", terminalId: "terminal-a" });
    // L'enfant hérite du rattachement en remontant la chaîne des parents.
    expect(owned?.children[0]?.link).toEqual({ kind: "owned", terminalId: "terminal-a" });
  });

  it("ne prétend pas à une certitude sur un processus lancé ailleurs", () => {
    const tree = buildProcessTree(scene, new Map([[100, "terminal-a"]]));
    const external = tree.find((node) => node.pid === 400);

    expect(external?.link.kind).toBe("inferred");
  });

  it("n'expose que les processus Claude en racine", () => {
    const tree = buildProcessTree(scene, new Map());
    expect(tree.map((node) => node.pid).sort()).toEqual([200, 400]);
  });

  it("descend les enfants sans les promouvoir en racine", () => {
    const all = flatten(buildProcessTree(scene, new Map()));
    expect(all.map((node) => node.pid).sort()).toEqual([200, 300, 400, 500]);
  });

  it("ne boucle pas sur une chaîne de parents circulaire", () => {
    const cycle = [
      process_(10, 20, "claude.exe"),
      process_(20, 10, "node.exe", "node.exe claude.js "),
    ];
    expect(() => flatten(buildProcessTree(cycle, new Map()))).not.toThrow();
  });
});

describe("ProcessLister", () => {
  it("refuse d'arrêter un identifiant absent de l'arbre Claude", async () => {
    // La garde n'est pas une formalité : une route capable de tuer n'importe quel
    // identifiant tuerait aussi bien une session de travail.
    const lister = new ProcessLister();
    expect(await lister.stop(4, new Map())).toBe(false);
    expect(await lister.stop(process.pid, new Map())).toBe(false);
  });
});
