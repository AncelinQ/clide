import { randomUUID } from "node:crypto";

import { spawn, type IPty } from "node-pty";

import { OscScanner, type ShellEvent } from "./osc.js";
import { installShellProfile, type ShellProfile } from "./shell-profile.js";

export type TerminalKind = "shell" | "claude";

/**
 * - `idle`    : un prompt attend une saisie.
 * - `running` : une commande est en cours.
 * - `failed`  : la dernière commande s'est terminée sur un code non nul.
 */
export type TerminalState = "idle" | "running" | "failed";

export interface TerminalInfo {
  id: string;
  kind: TerminalKind;
  projectRoot: string;
  /** Dossier courant du shell, tenu à jour par OSC 7. */
  cwd: string;
  state: TerminalState;
  lastExitCode?: number;
  title: string;
  exited: boolean;
}

export interface SpawnOptions {
  projectRoot: string;
  kind?: TerminalKind;
  cols?: number;
  rows?: number;
  /** Commande envoyée dès l'ouverture, `claude` pour un onglet Claude. */
  initialCommand?: string;
}

export interface TerminalEvents {
  data: (id: string, text: string) => void;
  state: (info: TerminalInfo) => void;
  exit: (id: string, exitCode: number) => void;
}

interface Terminal {
  info: TerminalInfo;
  pty: IPty;
  scanner: OscScanner;
}

const DEFAULT_SHELL = "pwsh.exe";

/**
 * Terminaux ConPTY de l'application.
 *
 * Chaque flux passe par un `OscScanner` avant d'atteindre le client : les
 * marqueurs d'intégration shell sont retirés et transformés en changements
 * d'état, le reste part tel quel vers xterm.js.
 */
export class PtyManager {
  readonly #terminals = new Map<string, Terminal>();
  readonly #listeners: { [K in keyof TerminalEvents]: Set<TerminalEvents[K]> } = {
    data: new Set(),
    state: new Set(),
    exit: new Set(),
  };
  #profile: ShellProfile | undefined;

  on<K extends keyof TerminalEvents>(event: K, listener: TerminalEvents[K]): () => void {
    this.#listeners[event].add(listener as never);
    return () => this.#listeners[event].delete(listener as never);
  }

  #emit<K extends keyof TerminalEvents>(event: K, ...args: Parameters<TerminalEvents[K]>): void {
    for (const listener of this.#listeners[event]) {
      (listener as (...a: unknown[]) => void)(...args);
    }
  }

  /** Installe le profil PowerShell une fois pour toutes les ouvertures suivantes. */
  async prepare(): Promise<ShellProfile> {
    this.#profile ??= await installShellProfile();
    return this.#profile;
  }

  async open(options: SpawnOptions): Promise<TerminalInfo> {
    const profile = await this.prepare();
    const kind = options.kind ?? "shell";
    const id = randomUUID();

    const pty = spawn(DEFAULT_SHELL, profile.args, {
      name: "xterm-256color",
      cols: options.cols ?? 100,
      rows: options.rows ?? 30,
      cwd: options.projectRoot,
      env: cleanEnvironment(process.env),
      useConpty: true,
    });

    const terminal: Terminal = {
      pty,
      scanner: new OscScanner(),
      info: {
        id,
        kind,
        projectRoot: options.projectRoot,
        cwd: options.projectRoot,
        state: "idle",
        title: kind === "claude" ? "claude" : "shell",
        exited: false,
      },
    };
    this.#terminals.set(id, terminal);

    pty.onData((chunk) => {
      const { text, events } = terminal.scanner.push(chunk);
      if (text.length > 0) this.#emit("data", id, text);
      if (events.length > 0) this.#applyShellEvents(terminal, events);
    });

    pty.onExit(({ exitCode }) => {
      terminal.info.exited = true;
      this.#emit("state", { ...terminal.info });
      this.#emit("exit", id, exitCode);
      this.#terminals.delete(id);
    });

    if (options.initialCommand) {
      // Le shell doit avoir rendu son premier prompt avant d'accepter une saisie.
      setTimeout(() => {
        if (!terminal.info.exited) pty.write(`${options.initialCommand}\r`);
      }, 1200);
    }

    return { ...terminal.info };
  }

  #applyShellEvents(terminal: Terminal, events: readonly ShellEvent[]): void {
    let changed = false;
    for (const event of events) {
      switch (event.kind) {
        case "cwd":
          if (terminal.info.cwd !== event.path) {
            terminal.info.cwd = event.path;
            changed = true;
          }
          break;
        case "command-start":
          terminal.info.state = "running";
          changed = true;
          break;
        case "command-end":
          terminal.info.state = event.exitCode === 0 ? "idle" : "failed";
          terminal.info.lastExitCode = event.exitCode;
          changed = true;
          break;
      }
    }
    if (changed) this.#emit("state", { ...terminal.info });
  }

  write(id: string, data: string): boolean {
    const terminal = this.#terminals.get(id);
    if (!terminal) return false;
    terminal.pty.write(data);
    return true;
  }

  resize(id: string, cols: number, rows: number): boolean {
    const terminal = this.#terminals.get(id);
    if (!terminal) return false;
    try {
      terminal.pty.resize(Math.max(cols, 2), Math.max(rows, 2));
      return true;
    } catch {
      return false;
    }
  }

  close(id: string): boolean {
    const terminal = this.#terminals.get(id);
    if (!terminal) return false;
    try {
      terminal.pty.kill();
    } catch {
      // Processus déjà parti : le nettoyage suit dans onExit.
    }
    return true;
  }

  get(id: string): TerminalInfo | undefined {
    const terminal = this.#terminals.get(id);
    return terminal ? { ...terminal.info } : undefined;
  }

  list(): TerminalInfo[] {
    return [...this.#terminals.values()].map((terminal) => ({ ...terminal.info }));
  }

  /**
   * Identifiants système des terminaux ouverts, par processus.
   *
   * C'est la seule source certaine pour rattacher un processus à une session :
   * Windows ne donne pas le répertoire de travail d'un processus tiers, donc tout
   * ce qui n'est pas parti d'ici ne peut être rattaché que par recoupement.
   */
  ownedPids(): Map<number, string> {
    const out = new Map<number, string>();
    for (const terminal of this.#terminals.values()) out.set(terminal.pty.pid, terminal.info.id);
    return out;
  }

  /** Terminal inactif réutilisable pour un projet, plutôt qu'en ouvrir un de plus. */
  findIdle(projectRoot: string, kind: TerminalKind = "shell"): TerminalInfo | undefined {
    for (const terminal of this.#terminals.values()) {
      const { info } = terminal;
      if (info.projectRoot === projectRoot && info.kind === kind && info.state === "idle") {
        return { ...info };
      }
    }
    return undefined;
  }

  closeAll(): void {
    for (const id of [...this.#terminals.keys()]) this.close(id);
  }
}

/**
 * Retire les variables que Claude Code place dans l'environnement de ses propres
 * processus. Les hériter dans un shell enfant désactive l'enregistrement du
 * transcript de la session qu'on y lancerait — et c'est précisément ce que les
 * panneaux lisent.
 */
export function cleanEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith("CLAUDE_CODE_")) continue;
    if (value !== undefined) out[key] = value;
  }
  return out;
}
