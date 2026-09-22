import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PtyManager, cleanEnvironment, normalizePath, type TerminalInfo } from "../src/pty/manager.js";

describe("normalizePath", () => {
  it("rend identiques les trois façons d'écrire un dossier Windows", () => {
    const expected = "c:/projets/perso/claude-ide";
    expect(normalizePath("C:\\Projets\\perso\\claude-ide")).toBe(expected);
    expect(normalizePath("C:/Projets/perso/claude-ide")).toBe(expected);
    expect(normalizePath("C:\\Projets\\perso\\claude-ide\\")).toBe(expected);
    expect(normalizePath("c:/PROJETS/Perso/Claude-IDE")).toBe(expected);
  });

  it("ne confond pas deux dossiers voisins", () => {
    expect(normalizePath("C:\\Projets\\perso")).not.toBe(normalizePath("C:\\Projets\\perso\\claude-ide"));
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

/**
 * Terminal réel sous ConPTY. Vérifie d'un bout à l'autre ce que le prototype
 * avait montré : le profil s'injecte, le shell rend la main, et ses marqueurs
 * remontent en changements d'état.
 */
describe.skipIf(process.platform !== "win32")("PtyManager sous ConPTY", () => {
  let manager: PtyManager;
  let scratch: string;

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), "claude-ide-pty-"));
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

    manager.write(terminal.id, "Write-Host BONJOUR-CLAUDE-IDE\r");
    await waitFor(() => output.join("").includes("BONJOUR-CLAUDE-IDE"), 15000);

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

  it("réutilise un terminal inactif plutôt que d'en ouvrir un autre", async () => {
    const terminal = await manager.open({ projectRoot: scratch });
    const idle = manager.findIdle(scratch);
    expect(idle?.id).toBe(terminal.id);
    manager.close(terminal.id);
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
