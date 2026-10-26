import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { normalizePath } from "@clide/core";
import { spawn, type IPty } from "node-pty";

import { DevUrlScanner } from "./dev-url.js";
import { OscScanner, type ShellEvent } from "./osc.js";
import {
  replayOf,
  replays,
  savedTerminalOf,
  typable,
  type LoadedTerminal,
  type TerminalSnapshot,
} from "./saved-terminals.js";
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
  /**
   * Ce qu'on a ouvert : un shell, ou un onglet Claude. `kind` suit la session
   * `claude` qui y tourne et change avec elle ; ceci ne change jamais, et range
   * l'onglet quand on groupe les onglets par type.
   */
  openedAs: TerminalKind;
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
  /**
   * Script que l'onglet fait tourner (`dossier|nom`). Tenu ici plutôt que par la
   * page : un rechargement retrouve l'onglet de chaque script, et le relancer
   * reprend le même onglet au lieu d'en ouvrir un autre.
   */
  script?: string;
  /**
   * Rouvert au lancement et pas encore montré : aucun processus ne tourne. Le
   * client le réveille (`wake`) à son premier affichage.
   */
  dormant?: true;
}

export interface SpawnOptions {
  projectRoot: string;
  kind?: TerminalKind;
  cols?: number;
  rows?: number;
  /** Commande envoyée dès l'ouverture, `claude` pour un onglet Claude. */
  initialCommand?: string;
  owner?: string;
  /** Nom de l'onglet, `projet › script` pour un script. */
  label?: string;
  /** Nom donné d'avance, comme à la main : celui d'une session qu'on reprend. */
  name?: string;
  script?: string;
}

export interface TerminalEvents {
  data: (id: string, text: string) => void;
  state: (info: TerminalInfo) => void;
  exit: (id: string, exitCode: number) => void;
  /** `claude` démarre dans l'onglet (avec sa ligne de commande) ou en sort (sans). */
  claude: (id: string, command: string | undefined) => void;
}

interface Terminal {
  /** Nom donné à l'ouverture, que l'onglet reprend quand `claude` en sort. */
  label?: string;
  /** Nom donné à la main : il l'emporte sur `claude` comme sur le nom d'ouverture. */
  name?: string;
  info: TerminalInfo;
  /** Absent tant que le terminal dort, et le temps de son lancement. */
  pty?: IPty;
  scanner: OscScanner;
  urls: DevUrlScanner;
  /** Fin de la sortie, rejouée dans un terminal qui se rattache après un rechargement. */
  backlog: string;
  /** Ligne de la commande qui tourne, telle que tapée ; absente quand le shell attend. */
  command?: string;
  /** Ce qu'a laissé un terminal rouvert au lancement, jusqu'à son réveil. */
  dormant?: LoadedTerminal;
  /** Commande à retaper, sans la lancer, au premier prompt. */
  retype?: string;
}

export interface WakeOptions {
  cols: number;
  rows: number;
  /** Commande lancée au réveil, la reprise de la session Claude. */
  initialCommand?: string;
}

/**
 * Taille de la sortie gardée par terminal. Assez pour retrouver l'écran et un peu
 * d'historique après un rechargement de la page, pas pour tenir un long journal.
 */
const BACKLOG_MAX = 256 * 1024;

const DEFAULT_SHELL = "pwsh.exe";

/** Le terminal que les onglets émulent : xterm.js, côté client. */
const TERMINAL_TYPE = "xterm-256color";

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

    const terminal: Terminal = {
      ...(options.label ? { label: options.label } : {}),
      ...(options.name ? { name: options.name } : {}),
      scanner: new OscScanner(),
      urls: new DevUrlScanner(),
      backlog: "",
      info: {
        id,
        kind,
        openedAs: kind,
        projectRoot: options.projectRoot,
        cwd: options.projectRoot,
        state: "idle",
        title: options.name ?? options.label ?? (kind === "claude" ? "claude" : "shell"),
        exited: false,
        ...(options.owner ? { owner: options.owner } : {}),
        ...(options.script ? { script: options.script } : {}),
      },
    };
    this.#terminals.set(id, terminal);
    this.#spawn(terminal, profile, {
      cols: options.cols ?? 100,
      rows: options.rows ?? 30,
      cwd: options.projectRoot,
      ...(options.initialCommand ? { initialCommand: options.initialCommand } : {}),
    });
    return { ...terminal.info };
  }

  /**
   * Inscrit un terminal gardé au dernier arrêt, avec son identifiant, sans
   * lancer de shell : il dort jusqu'à ce que `wake` le lance.
   */
  restore(loaded: LoadedTerminal): TerminalInfo {
    const { saved } = loaded;
    const existing = this.#terminals.get(saved.id);
    if (existing) return { ...existing.info };
    const terminal: Terminal = {
      ...(saved.label ? { label: saved.label } : {}),
      ...(saved.name ? { name: saved.name } : {}),
      scanner: new OscScanner(),
      urls: new DevUrlScanner(),
      backlog: "",
      dormant: loaded,
      info: {
        id: saved.id,
        kind: saved.kind,
        openedAs: saved.openedAs,
        projectRoot: saved.projectRoot,
        cwd: saved.cwd,
        state: "idle",
        title: "",
        exited: false,
        dormant: true,
        ...(saved.owner ? { owner: saved.owner } : {}),
        ...(saved.script ? { script: saved.script } : {}),
      },
    };
    terminal.info.title = titleOf(terminal);
    this.#terminals.set(saved.id, terminal);
    return { ...terminal.info };
  }

  /**
   * Lance le shell d'un terminal qui dort, avec le même identifiant.
   *
   * Un shell rejoue d'abord sa sortie d'avant, puis retrouve au premier prompt
   * la commande qui tournait, tapée mais pas lancée. Rend `undefined` pour un
   * terminal inconnu ou déjà réveillé.
   */
  async wake(id: string, options: WakeOptions): Promise<TerminalInfo | undefined> {
    const terminal = this.#terminals.get(id);
    if (!terminal?.dormant) return undefined;
    // Le réveil est noté avant d'attendre quoi que ce soit : un deuxième appel
    // pendant le lancement ne lancerait pas un deuxième shell.
    const { saved, scrollback } = terminal.dormant;
    delete terminal.dormant;
    delete terminal.info.dormant;

    const replay = replays(saved) ? replayOf(scrollback) : "";
    if (replay) {
      // ConPTY efface l'écran en démarrant puis dessine comme sur un écran vide :
      // la sortie rejouée doit être passée dans l'historique, sinon le shell
      // écrirait par-dessus.
      const text = replay + "\n".repeat(Math.max(options.rows, 1));
      terminal.backlog = text.slice(-BACKLOG_MAX);
      this.#emit("data", id, text);
    }
    if (!options.initialCommand && saved.command && typable(saved.command)) terminal.retype = saved.command;

    const profile = await this.prepare();
    // Fermé pendant ce temps : rien à lancer.
    if (this.#terminals.get(id) !== terminal) return undefined;
    const { info } = terminal;
    try {
      this.#spawn(terminal, profile, {
        cols: options.cols,
        rows: options.rows,
        cwd: existsSync(info.cwd) ? info.cwd : info.projectRoot,
        ...(options.initialCommand ? { initialCommand: options.initialCommand } : {}),
      });
    } catch {
      // Dossier du projet disparu : l'onglet se ferme comme un shell qui sort.
      this.#drop(terminal, 1);
      return undefined;
    }
    this.#emit("state", { ...info });
    return { ...info };
  }

  #spawn(terminal: Terminal, profile: ShellProfile, options: WakeOptions & { cwd: string }): void {
    const { id } = terminal.info;
    const pty = spawn(DEFAULT_SHELL, profile.args, {
      name: TERMINAL_TYPE,
      cols: options.cols,
      rows: options.rows,
      cwd: options.cwd,
      env: terminalEnvironment(id, process.env),
      useConpty: true,
    });
    terminal.pty = pty;

    pty.onData((chunk) => {
      const { text, events } = terminal.scanner.push(chunk);
      if (text.length > 0) {
        terminal.backlog = (terminal.backlog + text).slice(-BACKLOG_MAX);
        this.#emit("data", id, text);
      }
      if (events.length > 0) this.#applyShellEvents(terminal, events);
      if (text.length > 0) this.#watchDevUrl(terminal, text);
    });

    pty.onExit(({ exitCode }) => this.#drop(terminal, exitCode));

    if (options.initialCommand) {
      // Le shell doit avoir rendu son premier prompt avant d'accepter une saisie.
      setTimeout(() => {
        if (!terminal.info.exited) pty.write(`${options.initialCommand}\r`);
      }, 1200);
    }
  }

  /** Retire un terminal, comme quand son shell sort. */
  #drop(terminal: Terminal, exitCode: number): void {
    const { id } = terminal.info;
    if (this.#terminals.get(id) !== terminal) return;
    terminal.info.exited = true;
    this.#emit("state", { ...terminal.info });
    this.#emit("exit", id, exitCode);
    this.#terminals.delete(id);
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
          if (event.command?.trim()) terminal.command = event.command.trim();
          else delete terminal.command;
          changed = true;
          break;
        case "command-end":
          terminal.info.state = event.exitCode === 0 ? "idle" : "failed";
          terminal.info.lastExitCode = event.exitCode;
          delete terminal.command;
          changed = true;
          // Le premier prompt d'un terminal réveillé : la commande d'avant est
          // tapée, sans Entrée, et l'utilisateur décide de la relancer.
          if (terminal.retype) {
            terminal.pty?.write(terminal.retype);
            delete terminal.retype;
          }
          break;
        // Un `claude` tapé à la main fait de l'onglet un onglet Claude — plan,
        // activité, fichiers — le temps de la session, puis il redevient un shell.
        case "claude-start":
          terminal.info.kind = "claude";
          terminal.info.title = titleOf(terminal);
          changed = true;
          claude.push(event.command);
          break;
        case "claude-end":
          terminal.info.kind = "shell";
          terminal.info.title = titleOf(terminal);
          changed = true;
          claude.push(undefined);
          break;
      }
    }
    if (changed) this.#emit("state", { ...terminal.info });
    for (const command of claude) this.#emit("claude", terminal.info.id, command);
  }

  /** Nomme un onglet ; un nom vide lui rend celui qu'il aurait sans. */
  rename(id: string, name: string): boolean {
    const terminal = this.#terminals.get(id);
    if (!terminal) return false;
    const trimmed = name.trim();
    if (trimmed) terminal.name = trimmed;
    else delete terminal.name;
    terminal.info.title = titleOf(terminal);
    this.#emit("state", { ...terminal.info });
    return true;
  }

  /** Nom donné à un onglet, s'il en a un : ni `claude` ni son nom d'ouverture. */
  nameOf(id: string): string | undefined {
    return this.#terminals.get(id)?.name;
  }

  /** Commande qui tourne dans un onglet, telle que tapée, quand le profil l'a donnée. */
  commandOf(id: string): string | undefined {
    return this.#terminals.get(id)?.command;
  }

  /** Saisie pour le shell ; un terminal qui dort l'ignore. */
  write(id: string, data: string): boolean {
    const pty = this.#terminals.get(id)?.pty;
    if (!pty) return false;
    pty.write(data);
    return true;
  }

  resize(id: string, cols: number, rows: number): boolean {
    const pty = this.#terminals.get(id)?.pty;
    if (!pty) return false;
    try {
      pty.resize(Math.max(cols, 2), Math.max(rows, 2));
      return true;
    } catch {
      return false;
    }
  }

  close(id: string): boolean {
    const terminal = this.#terminals.get(id);
    if (!terminal) return false;
    // Sans processus — il dort ou se lance —, rien n'appellera onExit.
    if (!terminal.pty) {
      this.#drop(terminal, 0);
      return true;
    }
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

  /**
   * De quoi rouvrir les terminaux au lancement suivant. Un terminal qui dort
   * rend ce qu'il avait reçu, sous le nom qu'il porte maintenant.
   *
   * @param sessionOf session Claude attachée à un terminal, que l'onglet reprendra
   */
  snapshot(sessionOf: (id: string) => string | undefined): TerminalSnapshot[] {
    return [...this.#terminals.values()].map((terminal) => {
      if (terminal.dormant) {
        const { name: _name, ...saved } = terminal.dormant.saved;
        return {
          saved: { ...saved, ...(terminal.name ? { name: terminal.name } : {}) },
          scrollback: terminal.dormant.scrollback,
        };
      }
      const sessionId = sessionOf(terminal.info.id);
      // Une commande pas encore retapée, le shell n'ayant pas rendu son prompt,
      // reste celle qui tournait.
      const command = terminal.command ?? terminal.retype;
      return {
        saved: savedTerminalOf(terminal.info, {
          ...(terminal.label ? { label: terminal.label } : {}),
          ...(terminal.name ? { name: terminal.name } : {}),
          ...(command ? { command } : {}),
          ...(sessionId ? { sessionId } : {}),
        }),
        scrollback: terminal.backlog,
      };
    });
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
    for (const terminal of this.#terminals.values()) {
      if (terminal.pty) out.set(terminal.pty.pid, terminal.info.id);
    }
    return out;
  }

  /**
   * Terminal dont le dossier correspond à un chemin.
   *
   * Sert à rattacher un événement de hook à un onglet : Claude Code annonce le
   * dossier de la session, pas le terminal qui l'héberge. Le dossier courant
   * prime sur le dossier d'ouverture — un `cd` a pu déplacer le shell. Un
   * terminal qui dort ne fait tourner aucune session : il n'est pas candidat.
   */
  findByCwd(path: string): TerminalInfo | undefined {
    const wanted = normalizePath(path);
    let fallback: TerminalInfo | undefined;
    for (const { info, dormant } of this.#terminals.values()) {
      if (dormant) continue;
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
 * Nom d'un onglet : celui qu'on lui a donné, sinon `claude` le temps d'une
 * session, sinon son nom d'ouverture. Un onglet de script le retrouve en sortant
 * de `claude` : c'est par lui qu'on le reconnaît.
 */
function titleOf(terminal: Terminal): string {
  if (terminal.name) return terminal.name;
  if (terminal.info.kind === "claude") return "claude";
  return terminal.label ?? "shell";
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

/**
 * Environnement d'un onglet : celui du serveur nettoyé, le type de terminal, et
 * le nom de l'onglet.
 *
 * `TERM` décrit xterm.js, pas le terminal d'où le serveur a été lancé. Sous
 * Windows, node-pty ne le tire pas de son option `name`, et Clide lancé depuis
 * l'Explorateur n'en a pas : Claude Code se croirait alors sans Unicode et
 * dessinerait `>` et `√` au lieu de `❯` et `✔`, que la lecture de son écran
 * (`lib/claude-picker.ts` côté client) ne reconnaît pas.
 *
 * `claude` transmet son environnement à ses hooks : leur script rapporte ainsi
 * l'onglet exact d'où vient chaque événement, ce que le dossier de la session ne
 * dit pas quand deux onglets y travaillent.
 */
export function terminalEnvironment(id: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...cleanEnvironment(env), TERM: TERMINAL_TYPE, CLIDE_TERMINAL_ID: id };
}
