import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TerminalInfo } from "../src/pty/manager.js";
import {
  replayOf,
  restorable,
  restoreTabsOf,
  savedTerminalOf,
  TerminalSnapshots,
  type LoadedTerminal,
  type TerminalSnapshot,
} from "../src/pty/saved-terminals.js";

const ESC = "\u001b";
const SHELL = "11111111-1111-4111-8111-111111111111";
const CLAUDE = "22222222-2222-4222-8222-222222222222";
const GONE = "33333333-3333-4333-8333-333333333333";
const SESSION = "44444444-4444-4444-8444-444444444444";

function info(overrides: Partial<TerminalInfo> = {}): TerminalInfo {
  return {
    id: SHELL,
    kind: "shell",
    openedAs: "shell",
    projectRoot: "C:\\Projets\\app",
    cwd: "C:\\Projets\\app\\src",
    state: "idle",
    title: "shell",
    exited: false,
    ...overrides,
  };
}

let dataDir: string;
const listFile = (): string => join(dataDir, "terminals.json");
const scrollbackFile = (id: string): string => join(dataDir, "scrollback", `${id}.txt`);
const savedList = async (): Promise<unknown[]> =>
  (JSON.parse(await readFile(listFile(), "utf8")) as { terminals: unknown[] }).terminals;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "clide-terminals-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true, maxRetries: 3 });
});

describe("savedTerminalOf", () => {
  it("garde la commande en cours d'un shell, avec son nom et son dossier", () => {
    expect(savedTerminalOf(info({ owner: "C:\\Projets" }), { command: "pnpm dev", name: "front", label: "app" })).toEqual({
      id: SHELL,
      openedAs: "shell",
      kind: "shell",
      projectRoot: "C:\\Projets\\app",
      cwd: "C:\\Projets\\app\\src",
      owner: "C:\\Projets",
      label: "app",
      name: "front",
      command: "pnpm dev",
    });
  });

  it("ne garde pas la commande d'un onglet de script ni d'une session Claude", () => {
    expect(savedTerminalOf(info({ script: "C:\\Projets\\app|dev" }), { command: "pnpm dev" }).command).toBeUndefined();
    const claude = savedTerminalOf(info({ kind: "claude" }), { command: "claude", sessionId: "s1" });
    expect(claude.command).toBeUndefined();
    expect(claude.sessionId).toBe("s1");
  });

  it("ne garde pas une commande qu'on ne peut retaper sans la lancer", () => {
    expect(savedTerminalOf(info(), { command: "Get-Date\nGet-Location" }).command).toBeUndefined();
    expect(savedTerminalOf(info(), { command: "echo a\u001b[2J" }).command).toBeUndefined();
  });
});

describe("replayOf", () => {
  it("rejoue la sortie en gris sans ses couleurs, remet les modes à zéro et ajoute le séparateur", () => {
    const replay = replayOf(`${ESC}[31mrouge${ESC}[0m et ${ESC}[1;38;5;10mvert${ESC}[m${ESC}[?1049h`);

    expect(replay.startsWith(`${ESC}[90mrouge et vert${ESC}[?1049h`)).toBe(true);
    for (const mode of ["?1049l", "?25h", "?1000l", "?1002l", "?1003l", "?1006l", "?2004l"]) {
      expect(replay).toContain(`${ESC}[${mode}`);
    }
    expect(replay.match(/\u001b\[[0-9;:]*m/g)).toEqual([`${ESC}[90m`, `${ESC}[0m`, `${ESC}[90m`, `${ESC}[0m`]);
    expect(replay.endsWith(`\r\n${ESC}[90m── session restaurée ──${ESC}[0m\r\n`)).toBe(true);
  });

  it("ne rejoue rien d'une sortie vide", () => {
    expect(replayOf("")).toBe("");
  });
});

describe("restorable", () => {
  const loaded = (overrides: Partial<LoadedTerminal["saved"]>): LoadedTerminal => ({
    saved: { ...savedTerminalOf(info()), ...overrides },
    scrollback: "",
  });

  it("ne rouvre que les terminaux d'un projet ouvert dont le dossier existe", () => {
    const kept = loaded({ id: SHELL, owner: "C:/Projets/app/" });
    const worktree = loaded({ id: CLAUDE, owner: "C:\\Projets\\app", projectRoot: "C:\\Projets\\app.worktrees\\gone" });
    const closed = loaded({ id: GONE, projectRoot: "C:\\Projets\\autre", cwd: "C:\\Projets\\autre" });
    const exists = (path: string): boolean => path.startsWith("C:\\Projets\\app\\") || path === "C:\\Projets\\app";

    expect(restorable([kept, worktree, closed], ["C:\\Projets\\app"], exists).map(({ saved }) => saved.id)).toEqual([SHELL]);
  });

  it("rouvre dans le dossier du projet un terminal dont le dossier courant a disparu", () => {
    const [terminal] = restorable([loaded({ cwd: "C:\\Projets\\app\\disparu" })], ["C:\\Projets\\app"], (path) => path === "C:\\Projets\\app");
    expect(terminal?.saved.cwd).toBe("C:\\Projets\\app");
  });
});

describe("restoreTabsOf", () => {
  it("rouvre les onglets tant que le réglage n'est pas explicitement coupé", () => {
    expect(restoreTabsOf(undefined)).toBe(true);
    expect(restoreTabsOf({ version: 2, prefs: {} })).toBe(true);
    expect(restoreTabsOf({ version: 2, prefs: { restoreTabs: true } })).toBe(true);
    expect(restoreTabsOf({ version: 2, prefs: { restoreTabs: false } })).toBe(false);
  });
});

describe("TerminalSnapshots", () => {
  it("retrouve au lancement suivant les terminaux, et la sortie des seuls shells", async () => {
    const snapshots: TerminalSnapshot[] = [
      { saved: savedTerminalOf(info(), { command: "ping -t localhost" }), scrollback: "PS C:\\Projets\\app> ping -t localhost\r\n" },
      {
        saved: savedTerminalOf(info({ id: CLAUDE, kind: "claude", openedAs: "claude" }), { sessionId: SESSION }),
        scrollback: "écran de claude",
      },
    ];
    new TerminalSnapshots(dataDir, () => snapshots).flushSync();

    expect(await new TerminalSnapshots(dataDir, () => []).load()).toEqual([
      { saved: snapshots[0]?.saved, scrollback: "PS C:\\Projets\\app> ping -t localhost\r\n" },
      { saved: snapshots[1]?.saved, scrollback: "" },
    ]);
    expect(await readdir(join(dataDir, "scrollback"))).toEqual([`${SHELL}.txt`]);
  });

  it("écrit la liste peu après un changement, puis les sorties qui changent, et retire celles de trop", async () => {
    await mkdir(join(dataDir, "scrollback"));
    await writeFile(scrollbackFile(GONE), "terminal fermé");
    let scrollback = "un";
    const store = new TerminalSnapshots(dataDir, () => [{ saved: savedTerminalOf(info()), scrollback }], {
      list: 10,
      scrollback: 20,
    });

    store.schedule();
    await vi.waitFor(async () => expect(await savedList()).toHaveLength(1));

    store.start();
    await vi.waitFor(async () => expect(await readFile(scrollbackFile(SHELL), "utf8")).toBe("un"));
    scrollback = "deux";
    await vi.waitFor(async () => expect(await readFile(scrollbackFile(SHELL), "utf8")).toBe("deux"));
    expect(existsSync(scrollbackFile(GONE))).toBe(false);
    store.flushSync();
  });

  it("à l'arrêt, gèle les écritures : la fin des terminaux tués ne change plus la liste", async () => {
    let snapshots: TerminalSnapshot[] = [{ saved: savedTerminalOf(info()), scrollback: "sortie" }];
    const store = new TerminalSnapshots(dataDir, () => snapshots, { list: 5, scrollback: 5 });
    store.start();
    store.flushSync();

    snapshots = [];
    store.schedule();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await store.flush();

    expect(await savedList()).toHaveLength(1);
    expect(await readFile(scrollbackFile(SHELL), "utf8")).toBe("sortie");
  });

  it("retire à l'arrêt les sorties qu'aucun terminal ne nomme plus", async () => {
    await mkdir(join(dataDir, "scrollback"));
    await writeFile(scrollbackFile(GONE), "terminal fermé");
    await writeFile(`${scrollbackFile(SHELL)}.tmp`, "écriture interrompue");

    new TerminalSnapshots(dataDir, () => [{ saved: savedTerminalOf(info()), scrollback: "sortie" }]).flushSync();

    expect(await readdir(join(dataDir, "scrollback"))).toEqual([`${SHELL}.txt`]);
  });

  it("refuse un identifiant qui n'est pas un UUID, à la lecture comme à l'écriture", async () => {
    await writeFile(
      listFile(),
      JSON.stringify({
        version: 1,
        terminals: [
          { id: "../x", openedAs: "shell", kind: "shell", projectRoot: "C:\\x", cwd: "C:\\x" },
          { id: SHELL, openedAs: "shell", kind: "shell", projectRoot: "C:\\x" },
        ],
      }),
    );
    await writeFile(join(dataDir, "x.txt"), "hors du dossier");

    expect(await new TerminalSnapshots(dataDir, () => []).load()).toEqual([
      { saved: { id: SHELL, openedAs: "shell", kind: "shell", projectRoot: "C:\\x", cwd: "C:\\x" }, scrollback: "" },
    ]);

    new TerminalSnapshots(dataDir, () => [{ saved: { ...savedTerminalOf(info()), id: "../y" }, scrollback: "z" }]).flushSync();
    expect(existsSync(join(dataDir, "y.txt"))).toBe(false);
    expect(await savedList()).toEqual([]);
  });

  it("ne lit ni une session qui n'est pas un UUID ni une commande qui se lancerait", async () => {
    const entry = { openedAs: "shell", kind: "shell", projectRoot: "C:\\x", cwd: "C:\\x" };
    await writeFile(
      listFile(),
      JSON.stringify({
        version: 1,
        terminals: [
          { ...entry, id: SHELL, sessionId: "x; calc.exe", command: "Get-Date\r" },
          { ...entry, id: CLAUDE, kind: "claude", sessionId: SESSION },
        ],
      }),
    );

    const loaded = await new TerminalSnapshots(dataDir, () => []).load();
    expect(loaded.map(({ saved }) => [saved.sessionId, saved.command])).toEqual([
      [undefined, undefined],
      [SESSION, undefined],
    ]);
  });

  it("ne lit rien d'une liste absente ou illisible", async () => {
    expect(await new TerminalSnapshots(dataDir, () => []).load()).toEqual([]);
    await writeFile(listFile(), "{ pas du json");
    expect(await new TerminalSnapshots(dataDir, () => []).load()).toEqual([]);
  });

  it("désactivé, efface la liste et les sorties, et n'écrit plus rien", async () => {
    const snapshots = (): TerminalSnapshot[] => [{ saved: savedTerminalOf(info()), scrollback: "sortie" }];
    new TerminalSnapshots(dataDir, snapshots).flushSync();
    expect(existsSync(listFile())).toBe(true);

    const store = new TerminalSnapshots(dataDir, snapshots, { list: 5, scrollback: 5 });
    store.enabled = false;
    store.schedule();
    await store.flush();
    store.flushSync();

    expect(existsSync(listFile())).toBe(false);
    expect(existsSync(join(dataDir, "scrollback"))).toBe(false);
    expect(await store.load()).toEqual([]);
  });
});
