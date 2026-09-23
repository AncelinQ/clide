import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";

import { socketUrl } from "@/lib/api";
import type { ServerMessage, TerminalInfo, TerminalKind } from "@/lib/types";
import { dismissSystem, notifySystem } from "@/state/notify";
import { getState, setState } from "@/state/store";

/**
 * Les instances xterm vivent hors de React.
 *
 * Elles possèdent un nœud du DOM, un tampon de plusieurs milliers de lignes et
 * un canevas : les faire vivre et mourir au rythme des rendus les réinitialiserait
 * à chaque changement d'onglet. React ne reçoit que leur état.
 */
interface Attached {
  term: Terminal;
  fit: FitAddon;
  host: HTMLDivElement;
}

const attached = new Map<string, Attached>();
let socket: WebSocket | undefined;
/** Projet auquel rattacher le prochain terminal ouvert. */
let pendingOwner: string | null = null;

export function connect(): void {
  socket = new WebSocket(socketUrl("/pty"));
  socket.addEventListener("open", () => setState({ connected: true }));
  socket.addEventListener("close", () => {
    setState({ connected: false });
    setTimeout(connect, 1500);
  });
  socket.addEventListener("message", (event) => {
    onMessage(JSON.parse(String(event.data)) as ServerMessage);
  });
}

function send(message: unknown): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function onMessage(message: ServerMessage): void {
  switch (message.t) {
    case "hello":
      break;
    case "opened": {
      const owner = pendingOwner ?? getState().activeRoot;
      pendingOwner = null;
      if (!owner) return;
      setState((current) => ({
        terminals: { ...current.terminals, [message.terminal.id]: { info: message.terminal, owner } },
        activeTerminalId: message.terminal.id,
      }));
      break;
    }
    case "data":
      attached.get(message.id)?.term.write(message.data);
      break;
    case "state":
      setState((current) => {
        const existing = current.terminals[message.terminal.id];
        if (!existing) return {};
        return {
          terminals: { ...current.terminals, [message.terminal.id]: { ...existing, info: message.terminal } },
        };
      });
      break;
    case "exit":
      attached.get(message.id)?.term.write(`\r\n\u001b[90m— terminal fermé (${message.exitCode}) —\u001b[0m\r\n`);
      break;
    case "notification": {
      const { notification, terminalId } = message;
      setState((current) => ({
        notifications: [notification, ...current.notifications].slice(0, 100),
        attention:
          terminalId && terminalId !== current.activeTerminalId
            ? { ...current.attention, [terminalId]: notification.kind }
            : current.attention,
      }));
      notifySystem(notification, terminalId, focusTerminal);
      break;
    }
    case "resume":
      // La session repart : ce qu'elle attendait a été donné, la pastille ment.
      dismissSystem(message.terminalId);
      setState((current) => {
        if (!current.attention[message.terminalId]) return {};
        const attention = { ...current.attention };
        delete attention[message.terminalId];
        return { attention };
      });
      break;
    case "error":
      console.error("[claude-ide]", message.message);
      break;
  }
}

export function openTerminal(kind: TerminalKind, options: { command?: string; cwd?: string } = {}): void {
  const { activeRoot } = getState();
  if (!activeRoot) return;
  pendingOwner = activeRoot;
  send({
    t: "open",
    projectRoot: options.cwd ?? activeRoot,
    kind,
    cols: 100,
    rows: 30,
    ...(options.command ? { initialCommand: options.command } : {}),
  });
}

/** Script lancé dans chaque onglet, pour ne pas relancer celui qui tourne encore. */
const scripts = new Map<string, string>();

function samePath(a: string, b: string): boolean {
  const clean = (path: string) => path.replace(/[\\/]+$/, "").replace(/\//g, "\\").toLowerCase();
  return clean(a) === clean(b);
}

/**
 * Lance un script du projet.
 *
 * Le même script encore en cours est ramené au premier plan plutôt que lancé une
 * seconde fois. Sinon, un shell du projet qui ne fait rien le reçoit, et un
 * onglet n'est ouvert qu'à défaut : chaque lancement en ouvrirait un de plus.
 *
 * La saisie commence par Échap, qui vide la ligne en cours sous PSReadLine, pour
 * ne pas coller la commande derrière ce qui y traînait.
 */
export function runScript(name: string, directory: string, command: string): void {
  const { terminals, activeRoot } = getState();
  if (!activeRoot) return;
  const key = `${directory}|${name}`;
  const shells = Object.values(terminals)
    .filter((entry) => entry.owner === activeRoot && entry.info.kind === "shell" && !entry.info.exited)
    .map((entry) => entry.info);

  const running = shells.find((info) => info.state === "running" && scripts.get(info.id) === key);
  if (running) {
    focusTerminal(running.id);
    return;
  }

  const idle = shells.find((info) => info.state !== "running");
  if (!idle) {
    openTerminal("shell", { cwd: directory, command });
    return;
  }
  const move = samePath(idle.cwd, directory) ? "" : `Set-Location -LiteralPath '${directory.replace(/'/g, "''")}'; `;
  scripts.set(idle.id, key);
  typeInto(idle.id, `\u001b${move}${command}\r`);
  focusTerminal(idle.id);
}

export function closeTerminal(id: string): void {
  scripts.delete(id);
  send({ t: "close", id });
  attached.get(id)?.term.dispose();
  attached.delete(id);
  setState((current) => {
    const terminals = { ...current.terminals };
    delete terminals[id];
    const attention = { ...current.attention };
    delete attention[id];
    const remaining = Object.values(terminals).filter((entry) => entry.owner === current.activeRoot);
    return {
      terminals,
      attention,
      activeTerminalId:
        current.activeTerminalId === id ? (remaining[0]?.info.id ?? null) : current.activeTerminalId,
    };
  });
}

export function focusTerminal(id: string): void {
  const entry = getState().terminals[id];
  if (!entry) return;
  dismissSystem(id);
  setState((current) => {
    const attention = { ...current.attention };
    delete attention[id];
    // Regarder un terminal d'un autre projet suit ce projet : la colonne de
    // gauche doit décrire ce qu'on regarde.
    return { activeTerminalId: id, attention, activeRoot: entry.owner };
  });
  requestAnimationFrame(() => resize(id));
}

/** Écrit dans le terminal actif, pour insérer un chemin par exemple. */
export function typeInto(id: string, data: string): void {
  send({ t: "input", id, data });
}

export function resize(id: string): void {
  const entry = attached.get(id);
  if (!entry) return;
  try {
    entry.fit.fit();
  } catch {
    // Hôte pas encore mesuré : le prochain redimensionnement rattrapera.
    return;
  }
  send({ t: "resize", id, cols: entry.term.cols, rows: entry.term.rows });
  entry.term.focus();
}

export function resizeActive(): void {
  const { activeTerminalId } = getState();
  if (activeTerminalId) resize(activeTerminalId);
}

/**
 * Attache une instance à son hôte, ou la crée si c'est la première fois.
 * Le nœud est conservé d'un rendu à l'autre, avec son tampon.
 */
export function mount(info: TerminalInfo, host: HTMLDivElement, theme: Record<string, string>): void {
  const existing = attached.get(info.id);
  if (existing) {
    if (existing.host !== host) host.append(...existing.host.childNodes);
    return;
  }

  const term = new Terminal({
    fontFamily: 'Consolas, "Cascadia Mono", monospace',
    fontSize: 13,
    cursorBlink: true,
    theme,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host);
  term.onData((data) => send({ t: "input", id: info.id, data }));
  attached.set(info.id, { term, fit, host });
  requestAnimationFrame(() => resize(info.id));
}

export function applyTerminalTheme(theme: Record<string, string>): void {
  for (const entry of attached.values()) entry.term.options.theme = theme;
}
