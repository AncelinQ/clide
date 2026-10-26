import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { normalizePath } from "@clide/core";

import { PtyManager, cleanEnvironment, terminalEnvironment, type TerminalInfo } from "../src/pty/manager.js";
import { shellProfileScript } from "../src/pty/shell-profile.js";

describe("normalizePath", () => {
  it("rend identiques les trois façons d'écrire un dossier Windows", () => {
    const expected = "c:/projets/perso/clide";
    expect(normalizePath("C:\\Projets\\perso\\clide")).toBe(expected);
    expect(normalizePath("C:/Projets/perso/clide")).toBe(expected);
    expect(normalizePath("C:\\Projets\\perso\\clide\\")).toBe(expected);
    expect(normalizePath("c:/PROJETS/Perso/Clide")).toBe(expected);
  });

  it("ne confond pas deux dossiers voisins", () => {
    expect(normalizePath("C:\\Projets\\perso")).not.toBe(normalizePath("C:\\Projets\\perso\\clide"));
  });

  it("garde un chemin UNC reconnaissable", () => {
    expect(normalizePath("\\\\serveur\\partage")).toBe("/serveur/partage");
  });
});

describe("cleanEnvironment", () => {
  it("retire les variables de Claude Code et garde les autres", () => {
    const env = cleanEnvironment({
      PATH: "C:/bin",
      CLAUDE_CODE_SESSION: "x",
      CLAUDE_CODE_ENTRYPOINT: "cli",
      CLAUDEX: "garde-moi",
    });
    expect(env).toEqual({ PATH: "C:/bin", CLAUDEX: "garde-moi" });
  });
});

describe("terminalEnvironment", () => {
  it("nomme l'onglet et garde le nettoyage", () => {
    const env = terminalEnvironment("t1", { PATH: "C:\\bin", CLAUDE_CODE_ENTRYPOINT: "cli" });
    expect(env["CLIDE_TERMINAL_ID"]).toBe("t1");
    expect(env["PATH"]).toBe("C:\\bin");
    expect(env).not.toHaveProperty("CLAUDE_CODE_ENTRYPOINT");
  });

  it("annonce xterm, que le serveur ait un TERM ou non", () => {
    // Sans lui, Claude Code dessine `>` au lieu de `❯` : sa ligne de saisie n'est plus reconnue.
    expect(terminalEnvironment("t1", { PATH: "C:\\bin" })["TERM"]).toBe("xterm-256color");
    expect(terminalEnvironment("t1", { PATH: "C:\\bin", TERM: "cygwin" })["TERM"]).toBe("xterm-256color");
  });
});

describe("shellProfileScript", () => {
  it("n'écrit aucune barre oblique inverse", () => {
    // Un échappement traverse ici le générateur, le fichier, puis l'analyseur
    // PowerShell : il s'y perd, et l'erreur ne se voit qu'à l'exécution.
    expect(shellProfileScript()).not.toContain("\\");
  });

  it("recompose le chemin du fichier de prompt segment par segment", () => {
    const script = shellProfileScript();
    expect(script).toContain("Join-Path $PWD.Path '.claude' 'clide-prompt.md'");
    expect(script).toContain("--append-system-prompt-file");
  });

  it("signale l'entrée et la sortie de claude, même quand il échoue", () => {
    const script = shellProfileScript();
    expect(script).toContain("'CLAUDE_START;'");
    // La sortie est émise dans un `finally` : un Ctrl+C ou un échec de claude
    // ne doit pas laisser l'onglet en mode Claude.
    expect(script.indexOf("finally")).toBeLessThan(script.indexOf("'CLAUDE_END'"));
  });

  it("envoie la ligne tapée avec le début de commande, en base64", () => {
    const script = shellProfileScript();
    expect(script).toContain("GetBufferState");
    expect(script).toContain("'START;' + [Convert]::ToBase64String");
  });

  it("résout l'exécutable avant de poser la fonction du même nom", () => {
    // Sans cette résolution, la fonction s'appellerait elle-même à l'infini.
    const script = shellProfileScript();
    expect(script.indexOf("Get-Command claude")).toBeLessThan(script.indexOf("function global:claude"));
  });
});

/**
 * Terminal réel sous ConPTY. Vérifie d'un bout à l'autre ce que le prototype
 * avait montré : le profil s'injecte, le shell rend la main, et ses marqueurs
 * remontent en changements d'état.
 */
describe.skipIf(process.platform !== "win32")("PtyManager sous ConPTY", () => {
  let manager: PtyManager;
  let scratch: string;

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), "clide-pty-"));
    manager = new PtyManager();
  });

  afterAll(async () => {
    manager.closeAll();
    // Le dossier est le répertoire courant des shells qu'on vient de tuer :
    // Windows le garde verrouillé quelques instants après leur sortie.
    await new Promise((done) => setTimeout(done, 500));
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  it("ouvre un shell, suit son dossier et le code de sortie des commandes", async () => {
    const states: TerminalInfo[] = [];
    const output: string[] = [];
    manager.on("state", (info) => states.push(info));
    manager.on("data", (_id, text) => output.push(text));

    const terminal = await manager.open({ projectRoot: scratch, cols: 100, rows: 30 });
    expect(terminal.state).toBe("idle");

    // Laisser PowerShell charger les profils avant de lui parler.
    await waitFor(() => states.length > 0, 15000);

    manager.write(terminal.id, "Write-Host BONJOUR-CLIDE\r");
    await waitFor(() => output.join("").includes("BONJOUR-CLIDE"), 15000);
    // Ce qui est parti vers le client se rejoue après un rechargement de la page.
    expect(manager.backlog(terminal.id)).toContain("BONJOUR-CLIDE");

    manager.write(terminal.id, "cette-commande-nexiste-pas\r");
    await waitFor(() => states.some((state) => state.state === "failed"), 15000);

    const failed = states.filter((state) => state.state === "failed").at(-1);
    expect(failed?.lastExitCode).not.toBe(0);

    // Le dossier remonte par OSC 7, jamais par une supposition.
    const withCwd = states.find((state) => state.cwd.length > 0);
    expect(withCwd?.cwd.toLowerCase()).toContain("temp");

    // Les marqueurs ne doivent pas s'afficher dans le terminal.
    expect(output.join("")).not.toContain("]7771;");

    manager.close(terminal.id);
  }, 60_000);

  it("garde le nom d'un onglet de script et son script, même après un claude", async () => {
    const terminal = await manager.open({ projectRoot: scratch, label: "api › dev", script: `${scratch}|dev` });
    expect(terminal).toMatchObject({ title: "api › dev", script: `${scratch}|dev` });
    const titles: string[] = [];
    manager.on("state", (info) => info.id === terminal.id && titles.push(info.title));
    manager.write(terminal.id, "__clideEmit 'CLAUDE_START;claude'; __clideEmit 'CLAUDE_END'\r");
    await waitFor(() => titles.at(-1) === "api › dev" && titles.includes("claude"), 15000);
    manager.close(terminal.id);
    await waitFor(() => manager.get(terminal.id) === undefined, 15000);
  }, 30_000);

  it("garde le nom donné à un onglet, d'avance ou ensuite, à travers un claude, et rend le sien à un nom vide", async () => {
    const terminal = await manager.open({ projectRoot: scratch, name: "reprise" });
    expect(terminal.title).toBe("reprise");
    expect(manager.nameOf(terminal.id)).toBe("reprise");
    const titles: string[] = [];
    manager.on("state", (info) => info.id === terminal.id && titles.push(info.title));
    expect(manager.rename(terminal.id, "  revue  ")).toBe(true);
    expect(manager.get(terminal.id)?.title).toBe("revue");
    expect(manager.nameOf(terminal.id)).toBe("revue");
    manager.write(terminal.id, "__clideEmit 'CLAUDE_START;claude'\r");
    await waitFor(() => manager.get(terminal.id)?.kind === "claude", 15000);
    expect(manager.get(terminal.id)?.title).toBe("revue");
    manager.rename(terminal.id, "");
    expect(manager.get(terminal.id)?.title).toBe("claude");
    expect(manager.nameOf(terminal.id)).toBeUndefined();
    manager.write(terminal.id, "__clideEmit 'CLAUDE_END'\r");
    await waitFor(() => manager.get(terminal.id)?.kind === "shell", 15000);
    expect(titles.at(-1)).toBe("shell");
    expect(manager.rename("inconnu", "x")).toBe(false);
    manager.close(terminal.id);
    await waitFor(() => manager.get(terminal.id) === undefined, 15000);
  }, 30_000);

  it("fait d'un shell un onglet Claude le temps d'un claude, puis le rend, sans oublier qu'on a ouvert un shell", async () => {
    const terminal = await manager.open({ projectRoot: scratch });
    const kinds: string[] = [];
    const opened: string[] = [];
    const claude: (string | undefined)[] = [];
    manager.on("state", (info) => {
      if (info.id !== terminal.id) return;
      kinds.push(info.kind);
      opened.push(info.openedAs);
    });
    manager.on("claude", (id, command) => id === terminal.id && claude.push(command));
    await waitFor(() => kinds.length > 0, 15000);

    // La fonction `claude` du profil émet ces marqueurs ; on les émet ici sans
    // lancer Claude Code pour de vrai.
    manager.write(terminal.id, "__clideEmit 'CLAUDE_START;claude --resume x'; __clideEmit 'CLAUDE_END'\r");
    await waitFor(() => claude.length === 2, 15000);

    expect(claude).toEqual(["claude --resume x", undefined]);
    expect(kinds).toContain("claude");
    expect(kinds.at(-1)).toBe("shell");
    expect(terminal.openedAs).toBe("shell");
    expect(new Set(opened)).toEqual(new Set(["shell"]));
    manager.close(terminal.id);
    await waitFor(() => manager.get(terminal.id) === undefined, 15000);
  }, 30_000);

  it("relève l'adresse qu'annonce une commande, et l'oublie quand elle se termine", async () => {
    const terminal = await manager.open({ projectRoot: scratch });
    const urls: (string | undefined)[] = [];
    manager.on("state", (info) => info.id === terminal.id && urls.push(info.devUrl));
    await waitFor(() => urls.length > 0, 15000);

    // Le port affiché est calculé par le shell, et la ligne tapée porte une autre
    // adresse : le shell la redessine au lancement, elle ne doit pas être prise.
    manager.write(
      terminal.id,
      "Write-Host ('  Local:   http://localhost:' + (5000 + 173) + '/'); Start-Sleep 1 # http://localhost:9999/\r",
    );
    await waitFor(() => urls.includes("http://localhost:5173/"), 15000);
    expect(urls).not.toContain("http://localhost:9999/");
    await waitFor(() => manager.get(terminal.id)?.state === "idle", 15000);

    expect(manager.get(terminal.id)?.devUrl).toBeUndefined();
    manager.close(terminal.id);
    await waitFor(() => manager.get(terminal.id) === undefined, 15000);
  }, 30_000);

  it("sait quelle commande tourne, telle que tapée, et l'oublie quand elle finit", async () => {
    const terminal = await manager.open({ projectRoot: scratch });
    const states: string[] = [];
    manager.on("state", (info) => info.id === terminal.id && states.push(info.state));
    await waitFor(() => states.length > 0, 15000);

    manager.write(terminal.id, "Start-Sleep 2 # été; x\r");
    await waitFor(() => manager.get(terminal.id)?.state === "running", 15000);
    expect(manager.commandOf(terminal.id)).toBe("Start-Sleep 2 # été; x");

    await waitFor(() => manager.get(terminal.id)?.state === "idle", 15000);
    expect(manager.commandOf(terminal.id)).toBeUndefined();
    manager.close(terminal.id);
    await waitFor(() => manager.get(terminal.id) === undefined, 15000);
  }, 30_000);

  it("retrouve un terminal par son dossier, quel que soit le style de séparateur", async () => {
    // C'est ce rattachement qui dirige une notification de hook vers un onglet :
    // Claude Code annonce un dossier, pas un terminal.
    const terminal = await manager.open({ projectRoot: scratch });

    expect(manager.findByCwd(scratch)?.id).toBe(terminal.id);
    expect(manager.findByCwd(scratch.replace(/\\/g, "/"))?.id).toBe(terminal.id);
    expect(manager.findByCwd(`${scratch}\\`)?.id).toBe(terminal.id);
    expect(manager.findByCwd(`${scratch}\\sous-dossier`)).toBeUndefined();

    // Attendre la sortie effective : le terminal reste inscrit jusqu'à ce que
    // le processus soit parti, et le test suivant le retrouverait.
    manager.close(terminal.id);
    await waitFor(() => manager.get(terminal.id) === undefined, 15000);
  }, 30_000);

  it("rouvre un terminal endormi sous son identifiant, rejoue sa sortie en gris et retape la commande sans la lancer", async () => {
    const id = randomUUID();
    const saved = {
      id,
      openedAs: "shell" as const,
      kind: "shell" as const,
      projectRoot: scratch,
      cwd: scratch,
      name: "api",
      command: "Write-Host RETAPEE",
    };
    const scrollback = "\u001b[32mAVANT\u001b[0m\r\n";

    // Endormi : listé, mais sans processus ni sortie.
    expect(manager.restore({ saved, scrollback })).toMatchObject({ id, title: "api", dormant: true });
    expect(manager.list().find((terminal) => terminal.id === id)?.dormant).toBe(true);
    expect([...manager.ownedPids().values()]).not.toContain(id);
    expect(manager.backlog(id)).toBe("");
    expect(manager.snapshot(() => undefined).find((snapshot) => snapshot.saved.id === id)).toEqual({ saved, scrollback });

    const output: string[] = [];
    const states: string[] = [];
    manager.on("data", (terminalId, text) => terminalId === id && output.push(text));
    manager.on("state", (info) => info.id === id && states.push(info.state));

    const woken = await manager.wake(id, { cols: 100, rows: 30 });
    expect(woken).toMatchObject({ id, title: "api" });
    expect(woken?.dormant).toBeUndefined();
    expect(await manager.wake(id, { cols: 100, rows: 30 })).toBeUndefined();
    expect([...manager.ownedPids().values()]).toContain(id);

    // La sortie d'avant passe la première, en gris.
    expect(output[0]).toContain("\u001b[90mAVANT");
    expect(output[0]).toContain("── session restaurée ──");

    // La commande revient au prompt, tapée mais pas lancée.
    await waitFor(() => output.slice(1).join("").includes("RETAPEE"), 15000);
    await new Promise((done) => setTimeout(done, 1500));
    expect(states).not.toContain("running");
    expect(manager.get(id)?.state).toBe("idle");

    // Ctrl+C efface la ligne sans la mettre dans l'historique du shell.
    manager.write(id, "\u0003");
    manager.close(id);
    await waitFor(() => manager.get(id) === undefined, 15000);
  }, 30_000);

  it("tape à son premier prompt la saisie reçue par un terminal rouvert avant qu'il ne l'ait rendu", async () => {
    const id = randomUUID();
    manager.restore({ saved: { id, openedAs: "shell", kind: "shell", projectRoot: scratch, cwd: scratch }, scrollback: "" });
    // Le texte affiché n'est pas celui de la ligne tapée : il ne paraît que si elle a tourné.
    expect(manager.write(id, "Write-Host ('TE' + 'NUE')\r")).toBe(true);

    await manager.wake(id, { cols: 100, rows: 30 });
    await waitFor(() => /TENUE\s*\r?\n/.test(manager.backlog(id).replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "")), 15000);

    manager.close(id);
    await waitFor(() => manager.get(id) === undefined, 15000);
  }, 30_000);

  it("réveille une session Claude par sa commande de reprise, sans rejeu ni commande retapée", async () => {
    const id = randomUUID();
    manager.restore({
      saved: { id, openedAs: "claude", kind: "claude", projectRoot: scratch, cwd: scratch, sessionId: "s1", command: "Write-Host RETAPEE" },
      scrollback: "écran de claude",
    });
    // Destiné à Claude, il serait lancé dans le shell avant la reprise.
    manager.write(id, "Write-Host ('PER' + 'DUE')\r");
    const output: string[] = [];
    manager.on("data", (terminalId, text) => terminalId === id && output.push(text));

    await manager.wake(id, { cols: 100, rows: 30, initialCommand: "Write-Host REPRISE" });
    await waitFor(() => manager.backlog(id).includes("REPRISE"), 15000);

    expect(output.join("")).not.toContain("session restaurée");
    expect(output.join("")).not.toContain("RETAPEE");
    expect(output.join("")).not.toContain("PER");
    expect(manager.snapshot((terminalId) => (terminalId === id ? "s1" : undefined)).find((s) => s.saved.id === id)?.saved).toMatchObject({
      id,
      sessionId: "s1",
    });
    manager.close(id);
    await waitFor(() => manager.get(id) === undefined, 15000);
  }, 30_000);

  it("ferme un terminal endormi sans avoir à lancer son shell", () => {
    const id = randomUUID();
    const exits: string[] = [];
    manager.on("exit", (terminalId) => exits.push(terminalId));
    manager.restore({ saved: { id, openedAs: "shell", kind: "shell", projectRoot: scratch, cwd: scratch }, scrollback: "" });

    expect(manager.close(id)).toBe(true);
    expect(manager.get(id)).toBeUndefined();
    expect(exits).toEqual([id]);
  });

  it("ne fait rien sur un identifiant inconnu", () => {
    expect(manager.write("inconnu", "x")).toBe(false);
    expect(manager.resize("inconnu", 80, 24)).toBe(false);
    expect(manager.close("inconnu")).toBe(false);
  });
});

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("condition non atteinte dans le délai");
}
