import { randomUUID } from "node:crypto";

import { normalizePath } from "@claude-ide/core";
import { spawn, type IPty } from "node-pty";

import { DevUrlScanner } from "./dev-url.js";
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
  /** Adresse locale annoncée par la commande en cours : un serveur de développement. */
  devUrl?: string;
  /**
   * Projet de l'interface qui l'a ouvert. Il diffère du dossier pour un onglet
   * ouvert dans un worktree, et c'est lui qui range l'onglet quand la page se
   * recharge.
   */
  owner?: string;
}

export interface SpawnOptions {
  projectRoot: string;
  kind?: TerminalKind;
  cols?: number;
  rows?: number;
  /** Commande envoyée dès l'ouverture, `claude` pour un onglet Claude. */
  initialCommand?: string;
  owner?: string;
}

export interface TerminalEvents {
  data: (id: string, text: string) => void;
  state: (info: TerminalInfo) => void;
  exit: (id: string, exitCode: number) => void;
  /** `claude` démarre dans l'onglet (avec sa ligne de commande) ou en sort (sans). */
  claude: (id: string, command: string | undefined) => void;
}

interface Terminal {
  info: TerminalInfo;
  pty: IPty;
  scanner: OscScanner;
  urls: DevUrlScanner;
  /** Fin de la sortie, rejouée dans un terminal qui se rattache après un rechargement. */
  backlog: string;
}

/**
 * Taille de la sortie gardée par terminal. Assez pour retrouver l'écran et un peu
 * d'historique après un rechargement de la page, pas pour tenir un long journal.
 */
const BACKLOG_MAX = 256 * 1024;

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
    claude: new Set(),
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
      urls: new DevUrlScanner(),
      backlog: "",
      info: {
        id,
        kind,
        projectRoot: options.projectRoot,
        cwd: options.projectRoot,
        state: "idle",
        title: kind === "claude" ? "claude" : "shell",
        exited: false,
        ...(options.owner ? { owner: options.owner } : {}),
      },
    };
    this.#terminals.set(id, terminal);

    pty.onData((chunk) => {
      const { text, events } = terminal.scanner.push(chunk);
      if (text.length > 0) {
        terminal.backlog = (terminal.backlog + text).slice(-BACKLOG_MAX);
        this.#emit("data", id, text);
      }
      if (events.length > 0) this.#applyShellEvents(terminal, events);
      if (text.length > 0) this.#watchDevUrl(terminal, text);
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

  /**
   * Relève l'adresse qu'annonce une commande du shell, la première seulement.
   *
   * La sortie de Claude n'est pas lue : une adresse citée dans une réponse n'est
   * pas un serveur qui tourne.
   */
  #watchDevUrl(terminal: Terminal, text: string): void {
    const { info } = terminal;
    if (info.kind !== "shell" || info.state !== "running" || info.devUrl) return;
    const url = terminal.urls.push(text);
    if (!url) return;
    info.devUrl = url;
    this.#emit("state", { ...info });
  }

  #applyShellEvents(terminal: Terminal, events: readonly ShellEvent[]): void {
    let changed = false;
    const claude: (string | undefined)[] = [];
    for (const event of events) {
      // La commande qui avait annoncé l'adresse est finie, ou n'est plus lue.
      if (event.kind === "command-start" || event.kind === "command-end" || event.kind === "claude-start") {
        terminal.urls.reset({ skipLine: event.kind === "command-start" });
        if (terminal.info.devUrl) {
          delete terminal.info.devUrl;
          changed = true;
        }
      }
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
        // Un `claude` tapé à la main fait de l'onglet un onglet Claude — plan,
        // activité, fichiers — le temps de la session, puis il redevient un shell.
        case "claude-start":
          terminal.info.kind = "claude";
          terminal.info.title = "claude";
          changed = true;
          claude.push(event.command);
          break;
        case "claude-end":
          terminal.info.kind = "shell";
          terminal.info.title = "shell";
          changed = true;
          claude.push(undefined);
          break;
      }
    }
    if (changed) this.#emit("state", { ...terminal.info });
    for (const command of claude) this.#emit("claude", terminal.info.id, command);
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

  /** Fin de la sortie d'un terminal, telle qu'elle est partie vers le client. */
  backlog(id: string): string {
    return this.#terminals.get(id)?.backlog ?? "";
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

  /**
   * Terminal dont le dossier correspond à un chemin.
   *
   * Sert à rattacher un événement de hook à un onglet : Claude Code annonce le
   * dossier de la session, pas le terminal qui l'héberge. Le dossier courant
   * prime sur le dossier d'ouverture — un `cd` a pu déplacer le shell.
   */
  findByCwd(path: string): TerminalInfo | undefined {
    const wanted = normalizePath(path);
    let fallback: TerminalInfo | undefined;
    for (const { info } of this.#terminals.values()) {
      if (normalizePath(info.cwd) === wanted) return { ...info };
      if (!fallback && normalizePath(info.projectRoot) === wanted) fallback = { ...info };
    }
    return fallback;
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
