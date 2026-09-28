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

  it("fait d'un shell un onglet Claude le temps d'un claude, puis le rend", async () => {
    const terminal = await manager.open({ projectRoot: scratch });
    const kinds: string[] = [];
    const claude: (string | undefined)[] = [];
    manager.on("state", (info) => info.id === terminal.id && kinds.push(info.kind));
    manager.on("claude", (id, command) => id === terminal.id && claude.push(command));
    await waitFor(() => kinds.length > 0, 15000);

    // La fonction `claude` du profil émet ces marqueurs ; on les émet ici sans
    // lancer Claude Code pour de vrai.
    manager.write(terminal.id, "__clideEmit 'CLAUDE_START;claude --resume x'; __clideEmit 'CLAUDE_END'\r");
    await waitFor(() => claude.length === 2, 15000);

    expect(claude).toEqual(["claude --resume x", undefined]);
    expect(kinds).toContain("claude");
    expect(kinds.at(-1)).toBe("shell");
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
