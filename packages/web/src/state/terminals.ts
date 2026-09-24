import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";

import { t } from "@/i18n";
import { socketUrl } from "@/lib/api";
import type { ServerMessage, TerminalInfo, TerminalKind } from "@/lib/types";
import { dismissSystem, notifySystem } from "@/state/notify";
import { getState, setState, type TerminalFont } from "@/state/store";

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
/**
 * Sortie reçue pour un terminal dont l'instance n'existe pas encore : après un
 * rechargement, la fin de sa sortie arrive avant que React n'ait monté son hôte.
 */
const pending = new Map<string, string>();
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
      adopt(message.terminals, message.backlogs);
      break;
    case "opened": {
      const owner = pendingOwner ?? getState().activeRoot;
      pendingOwner = null;
      if (!owner) return;
      setState((current) => ({
        terminals: { ...current.terminals, [message.terminal.id]: { info: message.terminal, owner } },
        activeTerminalId: message.terminal.id,
        // Un onglet qu'on vient d'ouvrir est ce qu'on regarde, y compris quand il
        // reprend une session choisie dans History.
        followLive: true,
      }));
      break;
    }
    case "data": {
      const entry = attached.get(message.id);
      if (entry) entry.term.write(message.data);
      else if (getState().terminals[message.id]) pending.set(message.id, (pending.get(message.id) ?? "") + message.data);
      break;
    }
    case "state":
      setState((current) => {
        const existing = current.terminals[message.terminal.id];
        if (!existing) return {};
        // Revenu au shell, l'onglet n'a plus de session à montrer.
        const live = { ...current.live };
        if (message.terminal.kind === "shell") delete live[message.terminal.id];
        return {
          terminals: { ...current.terminals, [message.terminal.id]: { ...existing, info: message.terminal } },
          live,
        };
      });
      break;
    case "exit":
      attached.get(message.id)?.term.write(`\r\n\u001b[90m— ${t("terminal fermé ({code})", { code: message.exitCode })} —\u001b[0m\r\n`);
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
    case "live":
      setState((current) => {
        const previous = current.live[message.terminalId];
        // Le bloc bascule sur le plan quand l'onglet qu'on regarde entre en mode
        // plan : c'est là que la suite se décide.
        const entering =
          message.session.planMode === true &&
          previous?.planMode !== true &&
          message.terminalId === current.activeTerminalId &&
          current.followLive;
        return {
          live: { ...current.live, [message.terminalId]: message.session },
          ...(entering ? { sessionMode: "plan" } : {}),
        };
      });
      break;
    case "error":
      console.error("[clide]", message.message);
      break;
  }
}

/**
 * Reprend les terminaux que le serveur fait tourner, à la connexion.
 *
 * Après un rechargement de la page, les onglets n'existent plus que côté serveur :
 * ils sont rattachés à leur projet et leur sortie récente est rejouée. Après un
 * redémarrage du serveur, c'est l'inverse : les onglets que le client croyait
 * ouverts n'ont plus de processus, ils sont retirés.
 */
function adopt(terminals: TerminalInfo[], backlogs: Record<string, string>): void {
  const current = getState();
  const roots = current.projects.map((project) => project.root);
  const alive = new Set(terminals.map((info) => info.id));
  for (const [id, entry] of attached) {
    if (alive.has(id)) continue;
    entry.term.dispose();
    attached.delete(id);
  }
  const next: typeof current.terminals = {};
  for (const info of terminals) {
    const known = current.terminals[info.id];
    if (known) {
      next[info.id] = { ...known, info };
      continue;
    }
    // Un terminal ouvert avant que le serveur ne retienne son projet se range par
    // son dossier ; à défaut, dans le projet ouvert.
    const owner =
      info.owner ??
      roots.find((root) => info.projectRoot.toLowerCase().startsWith(root.toLowerCase())) ??
      current.activeRoot;
    if (!owner) continue;
    next[info.id] = { info, owner };
    const backlog = backlogs[info.id];
    if (backlog) pending.set(info.id, backlog);
  }
  const own = Object.values(next).filter((entry) => entry.owner === current.activeRoot);
  setState({
    terminals: next,
    activeTerminalId:
      current.activeTerminalId && next[current.activeTerminalId]
        ? current.activeTerminalId
        : (own.at(-1)?.info.id ?? null),
  });
}

export function openTerminal(kind: TerminalKind, options: { command?: string; cwd?: string } = {}): void {
  const { activeRoot } = getState();
  if (!activeRoot) return;
  pendingOwner = activeRoot;
  send({
    t: "open",
    owner: activeRoot,
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
  pending.delete(id);
  send({ t: "close", id });
  attached.get(id)?.term.dispose();
  attached.delete(id);
  setState((current) => {
    const terminals = { ...current.terminals };
    delete terminals[id];
    const attention = { ...current.attention };
    delete attention[id];
    const live = { ...current.live };
    delete live[id];
    const remaining = Object.values(terminals).filter((entry) => entry.owner === current.activeRoot);
    return {
      terminals,
      attention,
      live,
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
    return { activeTerminalId: id, attention, activeRoot: entry.owner, followLive: true };
  });
  requestAnimationFrame(() => resize(id));
}

/**
 * Onglet Claude du projet courant où envoyer une commande : l'actif s'il en est
 * un, sinon le premier ouvert. Aucun s'il n'y a pas d'onglet Claude vivant.
 */
export function claudeTabFor(root: string | null): string | undefined {
  const { terminals, activeTerminalId } = getState();
  const tabs = Object.values(terminals).filter(
    (entry) => entry.owner === root && entry.info.kind === "claude" && !entry.info.exited,
  );
  return (tabs.find((entry) => entry.info.id === activeTerminalId) ?? tabs[0])?.info.id;
}

/**
 * Tape une commande dans l'onglet Claude du projet et l'y amène.
 *
 * Sans Échap devant, contrairement aux shells : dans Claude Code, Échap
 * interrompt le tour en cours, et deux de suite ouvrent le retour arrière. Une
 * commande envoyée pendant que Claude travaille part dans sa file d'attente.
 *
 * Entrée part à part, un instant après : reçu dans le même bloc que le texte,
 * Claude Code le lit comme un collage, où Entrée ajoute une ligne au lieu
 * d'envoyer. Une commande courte passe, un prompt de trois lignes reste en saisie.
 */
export function sendToClaude(command: string): boolean {
  const id = claudeTabFor(getState().activeRoot);
  if (!id) return false;
  typeInto(id, command);
  setTimeout(() => typeInto(id, "\r"), 150);
  focusTerminal(id);
  return true;
}

/** Écrit dans le terminal actif, pour insérer un chemin par exemple. */
export function typeInto(id: string, data: string): void {
  send({ t: "input", id, data });
}

export function resize(id: string, options: { focus?: boolean } = {}): void {
  const entry = attached.get(id);
  if (!entry) return;
  try {
    entry.fit.fit();
  } catch {
    // Hôte pas encore mesuré : le prochain redimensionnement rattrapera.
    return;
  }
  send({ t: "resize", id, cols: entry.term.cols, rows: entry.term.rows });
  if (options.focus !== false) entry.term.focus();
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
    // Le nouvel hôte devient la référence : garder l'ancien ferait chercher le
    // terminal, au remontage suivant, dans un nœud qu'on vient de vider.
    if (existing.host !== host) {
      host.append(...existing.host.childNodes);
      existing.host = host;
    }
    return;
  }

  const { terminalFont } = getState();
  const term = new Terminal({
    fontFamily: fontStack(terminalFont.family),
    fontSize: terminalFont.size,
    cursorBlink: true,
    theme,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host);
  term.onData((data) => send({ t: "input", id: info.id, data }));
  attached.set(info.id, { term, fit, host });
  const backlog = pending.get(info.id);
  if (backlog) {
    term.write(backlog);
    pending.delete(info.id);
  }
  requestAnimationFrame(() => resize(info.id));
}

const DEFAULT_STACK = 'Consolas, "Cascadia Mono", monospace';

/** Pile de polices xterm : la famille choisie, puis la pile par défaut en secours. */
export function fontStack(family: string): string {
  return family ? `"${family.replace(/"/g, "")}", ${DEFAULT_STACK}` : DEFAULT_STACK;
}

/**
 * Applique la police à tous les terminaux ouverts.
 *
 * Seul l'onglet visible est réajusté : un hôte masqué mesure zéro, et chaque
 * onglet se réajuste de toute façon quand il reprend le premier plan.
 */
export function applyTerminalFont(font: TerminalFont): void {
  for (const entry of attached.values()) {
    entry.term.options.fontFamily = fontStack(font.family);
    entry.term.options.fontSize = font.size;
  }
  // Sans reprendre le focus : le réglage se fait depuis un champ qu'il ne faut
  // pas quitter à chaque chiffre tapé.
  const { activeTerminalId } = getState();
  if (activeTerminalId) resize(activeTerminalId, { focus: false });
}

export function applyTerminalTheme(theme: Record<string, string>): void {
  for (const entry of attached.values()) entry.term.options.theme = theme;
}
