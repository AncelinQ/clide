import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";

import { t } from "@/i18n";
import { socketUrl } from "@/lib/api";
import { afterClose, backTarget, lookAt, natureOf, placementOf, shelfOrder, type ScriptsShelf } from "@/lib/script-shelf";
import { isTerminalReply } from "@/lib/terminal-input";
import type { ServerMessage, TerminalInfo, TerminalKind } from "@/lib/types";
import { ownActiveTab, ownerOf, tabToShow } from "@/lib/workspace";
import { nativeZoom, onZoomChange } from "@/state/interface";
import { applyMarkers } from "@/state/editor";
import { dismissSystem, notifySystem } from "@/state/notify";
import {
  activateProject,
  forgetTab,
  getState,
  inBar,
  openProject,
  placedIn,
  rememberTab,
  scriptsShown,
  sessionTabOf,
  setState,
  tabsOf,
  type Project,
  type State,
  type TerminalFont,
} from "@/state/store";

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
/** Scripts ouverts en arrière-plan : leur nouvel onglet ne passe pas devant ce qu'on regarde. */
const backgroundScripts = new Set<string>();
/** Commande d'un script dont l'onglet s'ouvre, par clé : elle est retenue à l'arrivée de son identifiant. */
const pendingCommands = new Map<string, string>();

export function connect(): void {
  socket = new WebSocket(socketUrl("/pty"));
  socket.addEventListener("open", () => {
    setState({ connected: true });
    for (const listener of openListeners) listener();
  });
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

const openListeners = new Set<() => void>();

/** Envoie un message au serveur, et prévient à chaque (re)connexion : un abonnement se redemande alors. */
export const serverSocket = {
  send,
  onOpen(listener: () => void): () => void {
    openListeners.add(listener);
    return () => openListeners.delete(listener);
  },
};

function onMessage(message: ServerMessage): void {
  switch (message.t) {
    case "hello":
      adopt(message.terminals, message.backlogs);
      break;
    case "opened": {
      // Le serveur renvoie le projet de la demande : deux ouvertures rapprochées ne
      // se volent pas leur propriétaire.
      const owner = message.terminal.owner ?? pendingOwner;
      pendingOwner = null;
      if (!owner) return;
      const id = message.terminal.id;
      const script = message.terminal.script;
      const command = script ? pendingCommands.get(script) : undefined;
      if (script) pendingCommands.delete(script);
      const remember = (projects: Project[]) =>
        command === undefined ? projects : withShelf(projects, owner, (shelf) => ({ ...shelf, commands: { ...shelf.commands, [id]: command } }));
      if (script && backgroundScripts.delete(script)) {
        setState((current) => ({
          terminals: { ...current.terminals, [id]: { info: message.terminal, owner } },
          // Lancé sans qu'on le regarde, il est celui que l'onglet Scripts montrera,
          // sauf si l'onglet est déjà sous les yeux : on n'y change pas de script.
          projects: remember(
            owner === current.activeRoot && scriptsShown(current)
              ? current.projects
              : withShelf(current.projects, owner, (shelf) => ({ ...shelf, selected: id })),
          ),
        }));
        break;
      }
      setState((current) => {
        const next = { ...current, terminals: { ...current.terminals, [id]: { info: message.terminal, owner } } };
        return {
          terminals: next.terminals,
          // Un onglet qu'on vient d'ouvrir passe devant un fichier montré dans son projet.
          projects: remember(owner === current.activeRoot ? lookedAt(next, owner, id) : rememberTab(current.projects, owner, id)),
          // Un onglet qu'on vient d'ouvrir est ce qu'on regarde, y compris quand il
          // reprend une session choisie dans History — sauf si l'on a changé de
          // projet entre la demande et la réponse : il attend qu'on y revienne.
          ...(owner === current.activeRoot ? { activeTerminalId: id, followLive: true } : {}),
        };
      });
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
          message.terminalId === sessionTabOf(current) &&
          current.followLive;
        const owner = current.terminals[message.terminalId]?.owner;
        return {
          live: { ...current.live, [message.terminalId]: message.session },
          ...(entering && owner
            ? { projects: current.projects.map((project) => (project.root === owner ? { ...project, bottomMode: "plan" } : project)) }
            : {}),
        };
      });
      break;
    case "error":
      console.error("[clide]", message.message);
      break;
    case "diagnostics":
      setState((current) => ({ diagnostics: { ...current.diagnostics, [message.report.root]: message.report } }));
      applyMarkers(message.report);
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
    // son dossier. Sans projet ouvert qui le contienne, il n'est montré nulle part.
    const owner = info.owner ?? ownerOf(info.projectRoot, roots);
    if (!owner) continue;
    next[info.id] = { info, owner };
    const backlog = backlogs[info.id];
    if (backlog) pending.set(info.id, backlog);
  }
  const kept = { ...current, terminals: next };
  setState({
    terminals: next,
    // Les commandes retenues des terminaux que le serveur n'a plus ne serviront plus.
    projects: current.projects.map((project) => pruneShelf(project, next)),
    activeTerminalId:
      ownActiveTab(next, current.activeTerminalId, current.activeRoot) ??
      (current.activeRoot
        ? tabToShow(
            next,
            current.projects.find((project) => project.root === current.activeRoot)?.activeTab,
            current.activeRoot,
            (id) => inBar(kept, id),
          )
        : null),
  });
}

/** Le projet `root` avec un onglet Scripts transformé par `change`. */
function withShelf(projects: Project[], root: string, change: (shelf: ScriptsShelf) => ScriptsShelf): Project[] {
  return projects.map((project) => (project.root === root ? { ...project, scripts: change(project.scripts) } : project));
}

/** Le projet sans les commandes ni les rangements retenus de terminaux qui n'existent plus. */
function pruneShelf(project: Project, terminals: State["terminals"]): Project {
  const { commands, placed } = project.scripts;
  const ids = [...Object.keys(commands), ...Object.keys(placed)];
  if (ids.every((id) => terminals[id])) return project;
  const alive = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).filter(([id]) => terminals[id]));
  return { ...project, scripts: { ...project.scripts, commands: alive(commands), placed: alive(placed) } };
}

/**
 * Projets une fois `id` regardé dans `owner` : il devient son dernier onglet et
 * passe devant un fichier ouvert ; l'onglet Scripts retient ce qu'on quitte en y
 * entrant, et le script qu'on y regarde.
 */
function lookedAt(current: State, owner: string, id: string): Project[] {
  const target = current.terminals[id]?.info;
  return current.projects.map((project) => {
    if (project.root !== owner) return project;
    const fromTab = owner === current.activeRoot ? current.activeTerminalId : project.activeTab;
    const from = fromTab ? current.terminals[fromTab]?.info : undefined;
    const scripts = target
      ? lookAt(
          project.scripts,
          { tab: from ? from.id : null, placement: from ? placementOf(from, project.scripts.placed) : null, file: project.activeFile },
          { id, placement: placementOf(target, project.scripts.placed), nature: natureOf(target) },
        )
      : project.scripts;
    return { ...project, activeTab: id, activeFile: null, scripts };
  });
}

export function openTerminal(
  kind: TerminalKind,
  options: { command?: string; cwd?: string; label?: string; script?: string; owner?: string } = {},
): void {
  const owner = options.owner ?? getState().activeRoot;
  if (!owner) return;
  pendingOwner = owner;
  // Ouvert caché, en arrière-plan ou derrière l'onglet Scripts, il écrit déjà à
  // la taille du terminal qu'on voit.
  const size = visibleSize() ?? { cols: 100, rows: 30 };
  send({
    t: "open",
    owner,
    projectRoot: options.cwd ?? owner,
    kind,
    cols: size.cols,
    rows: size.rows,
    ...(options.command ? { initialCommand: options.command } : {}),
    ...(options.label ? { label: options.label } : {}),
    ...(options.script ? { script: options.script } : {}),
  });
}

/**
 * Reprend une session dans le projet qui contient son dossier.
 *
 * Le projet ouvert le plus profond qui la contient la reçoit ; sans lui, son
 * dossier est ouvert comme projet. Dans les deux cas on y bascule : l'onglet
 * repris est ce qu'on veut voir.
 */
export function resumeSession(sessionId: string, cwd: string | undefined): void {
  if (cwd) {
    const owner = ownerOf(cwd, getState().projects.map((project) => project.root));
    if (owner) activateProject(owner);
    else openProject(cwd);
  }
  openTerminal("claude", { ...(cwd ? { cwd } : {}), command: `claude --resume ${sessionId}` });
}

function samePath(a: string, b: string): boolean {
  const clean = (path: string) => path.replace(/[\\/]+$/, "").replace(/\//g, "\\").toLowerCase();
  return clean(a) === clean(b);
}

/** Clé d'un script : son dossier et son nom. Le serveur la garde avec l'onglet. */
export function scriptKey(directory: string, name: string): string {
  return `${directory}|${name}`;
}

/** Onglet d'un script dans un projet, fini ou en cours, s'il en a un vivant. */
function scriptTab(key: string, root: string | null): TerminalInfo | undefined {
  const { terminals } = getState();
  return Object.values(terminals).find((entry) => entry.owner === root && entry.info.script === key && !entry.info.exited)?.info;
}

/** Onglet vivant d'un script dans le projet actif, quoi qu'il fasse : Claude peut y tourner. */
export function scriptTabOf(directory: string, name: string): TerminalInfo | undefined {
  return scriptTab(scriptKey(directory, name), getState().activeRoot);
}

/**
 * Lance un script dans son onglet, nommé `dossier › script`.
 *
 * Chaque script a le sien, qu'on retrouve : encore en cours, il est ramené au
 * premier plan plutôt que lancé une seconde fois ; fini, il y est relancé ; sans
 * onglet, un onglet s'ouvre. Plusieurs scripts tournent donc côte à côte, chacun
 * dans le dossier de son projet ou de son dossier lié.
 *
 * La relance commence par Échap, qui vide la ligne en cours sous PSReadLine, pour
 * ne pas coller la commande derrière ce qui y traînait. Rien n'est tapé dans un
 * onglet où Claude tourne : Échap l'interromprait, et la commande deviendrait un
 * prompt. L'onglet est seulement montré.
 *
 * Chaque lancement retient sa commande dans l'onglet Scripts : c'est elle que
 * relancer retape, et non la dernière ligne tapée dans le shell.
 *
 * `focus: true` montre le script, `false` jamais ; sans l'option, le réglage
 * « Au lancement d'un script » décide. Un script lancé sans être montré devient
 * celui que l'onglet Scripts montrera, sauf s'il est déjà sous les yeux.
 */
export function runScript(
  name: string,
  directory: string,
  command: string,
  options: { focus?: boolean; root?: string } = {},
): void {
  const root = options.root ?? getState().activeRoot;
  if (!root) return;
  const key = scriptKey(directory, name);
  const tab = scriptTab(key, root);
  const focus = options.focus ?? getState().scriptLaunch === "show";
  // Lancé sans être montré, il est celui que l'onglet Scripts montrera.
  const select = (shelf: ScriptsShelf, id: string, current: State): ScriptsShelf =>
    focus || (root === current.activeRoot && scriptsShown(current)) ? shelf : { ...shelf, selected: id };
  if (tab && (tab.kind === "claude" || tab.state === "running")) {
    if (focus) focusTerminal(tab.id);
    else if (tab.kind !== "claude") setState((current) => ({ projects: withShelf(current.projects, root, (shelf) => select(shelf, tab.id, current)) }));
    return;
  }
  if (tab) {
    setState((current) => ({
      projects: withShelf(current.projects, root, (shelf) => ({
        ...select(shelf, tab.id, current),
        commands: { ...shelf.commands, [tab.id]: command },
      })),
    }));
    const move = samePath(tab.cwd, directory) ? "" : `Set-Location -LiteralPath '${directory.replace(/'/g, "''")}'; `;
    typeInto(tab.id, `\u001b${move}${command}\r`);
    if (focus) focusTerminal(tab.id);
    return;
  }
  const folder = directory.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? directory;
  pendingCommands.set(key, command);
  if (!focus) backgroundScripts.add(key);
  openTerminal("shell", { cwd: directory, command, label: `${folder} › ${name}`, script: key, owner: root });
}

/**
 * Onglet où un script tourne encore, s'il y en a un. Un onglet où Claude tourne
 * n'en est pas un : l'arrêter par Ctrl+C viserait la session.
 */
export function runningScriptTab(directory: string, name: string): string | undefined {
  const tab = scriptTabOf(directory, name);
  return tab?.state === "running" && tab.kind !== "claude" ? tab.id : undefined;
}

/** Interrompt ce qui tourne dans un onglet, par Ctrl+C, et le montre sauf `show: false`. */
export function interruptTerminal(id: string, options: { show?: boolean } = {}): void {
  typeInto(id, "\u0003");
  if (options.show !== false) focusTerminal(id);
}

/** Nomme un onglet ; le serveur le garde, et un nom vide lui rend le sien. */
export function renameTerminal(id: string, name: string): void {
  send({ t: "rename", id, name });
}

export function closeTerminal(id: string): void {
  pending.delete(id);
  send({ t: "close", id });
  attached.get(id)?.term.dispose();
  attached.delete(id);
  setState((current) => {
    const closed = current.terminals[id];
    const terminals = { ...current.terminals };
    delete terminals[id];
    const attention = { ...current.attention };
    delete attention[id];
    const live = { ...current.live };
    delete live[id];
    let projects = forgetTab(current.projects, id).map((project) => (project.root === closed?.owner ? pruneShelf(project, terminals) : project));
    let activeTerminalId = current.activeTerminalId;
    const project = projects.find((item) => item.root === current.activeRoot);
    // Les rangements d'avant la fermeture : celui du terminal fermé vient d'être élagué.
    const placed = placedIn(current, current.activeRoot);
    if (closed && project && current.activeTerminalId === id) {
      // Le voisin dans l'onglet Scripts, sinon le retour vers la barre : fermer
      // un onglet de la barre ne fait jamais entrer dans l'onglet Scripts.
      const { bar, shelf } = tabsOf(current, project.root);
      const barIds = bar.map((info) => info.id);
      const next = afterClose(
        { id, placement: placementOf(closed.info, placed) },
        { bar: barIds, shelf: shelfOrder(shelf).map((info) => info.id) },
        backTarget(project.scripts, barIds.filter((item) => item !== id), project.openFiles),
      );
      activeTerminalId = next.tab;
      if (next.file && !project.activeFile) {
        projects = projects.map((item) => (item.root === project.root ? { ...item, activeFile: next.file } : item));
      }
      // Le voisin montré dans l'onglet Scripts devient le script retenu, et son groupe se déplie.
      const shown = next.tab ? terminals[next.tab]?.info : undefined;
      if (shown && placementOf(shown, placed) === "scripts") {
        projects = withShelf(projects, project.root, (shelf) =>
          lookAt(shelf, { tab: id, placement: "scripts", file: null }, { id: shown.id, placement: "scripts", nature: natureOf(shown) }),
        );
      }
    }
    return { terminals, attention, live, projects, activeTerminalId };
  });
}

/** Ce qu'a donné la recherche d'une ligne dans un terminal. */
export type RevealOutcome = "found" | "missing" | "fullscreen" | "absent";

const squash = (text: string): string => text.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Fait défiler un terminal jusqu'à une ligne et la sélectionne.
 *
 * Le texte est cherché dans l'historique, lignes repliées recollées. `fromEnd`
 * dit laquelle prendre quand il revient plusieurs fois, en comptant depuis la
 * fin : le début de l'historique a pu être perdu, la fin jamais.
 *
 * Rien n'est possible en plein écran : Claude Code y dessine lui-même l'écran,
 * dans le tampon secondaire du terminal, qui n'a pas d'historique.
 */
export function revealInTerminal(id: string, needles: string[], fromEnd = 0): RevealOutcome {
  const entry = attached.get(id);
  if (!entry) return "absent";
  const buffer = entry.term.buffer.active;
  if (buffer.type === "alternate") return "fullscreen";

  const logical: { row: number; last: number; text: string }[] = [];
  for (let row = 0; row < buffer.length; row++) {
    const line = buffer.getLine(row);
    if (!line) continue;
    const text = line.translateToString(true);
    const previous = logical.at(-1);
    if (line.isWrapped && previous) {
      previous.text += text;
      previous.last = row;
    } else {
      logical.push({ row, last: row, text });
    }
  }

  for (const needle of needles.map(squash).filter((value) => value.length >= 3)) {
    const hits = logical.filter((line) => squash(line.text).includes(needle));
    const hit = hits[hits.length - 1 - Math.min(fromEnd, hits.length - 1)];
    if (!hit) continue;
    focusTerminal(id);
    // Après l'activation de l'onglet : son redimensionnement ramènerait sinon la vue en bas.
    setTimeout(() => {
      entry.term.scrollToLine(Math.max(0, hit.row - 2));
      entry.term.selectLines(hit.row, hit.last);
    }, 80);
    return "found";
  }
  return "missing";
}

/**
 * Montre un terminal, dans la barre ou dans l'onglet Scripts selon où il vit.
 * `focus: false` le montre sans lui donner le clavier : la liste de l'onglet
 * Scripts garde ainsi le sien quand on la parcourt aux flèches.
 */
export function focusTerminal(id: string, options: { focus?: boolean } = {}): void {
  const entry = getState().terminals[id];
  if (!entry) return;
  dismissSystem(id);
  setState((current) => {
    const attention = { ...current.attention };
    delete attention[id];
    // Regarder un terminal d'un autre projet suit ce projet : la colonne de
    // gauche doit décrire ce qu'on regarde. Le projet retient l'onglet, pour
    // le rendre quand on y revient, et le remet devant un fichier ouvert.
    return {
      activeTerminalId: id,
      attention,
      activeRoot: entry.owner,
      followLive: true,
      projects: lookedAt(current, entry.owner, id),
    };
  });
  requestAnimationFrame(() => resize(id, { focus: options.focus !== false }));
}

/**
 * Onglet Claude du projet courant où envoyer une commande : l'actif s'il en est
 * un, sinon le premier ouvert. Aucun s'il n'y a pas d'onglet Claude vivant.
 */
export function claudeTabFor(root: string | null): string | undefined {
  const { terminals, activeTerminalId, projects } = getState();
  const tabs = Object.values(terminals).filter(
    (entry) => entry.owner === root && entry.info.kind === "claude" && !entry.info.exited,
  );
  // Depuis l'onglet Scripts, la session qu'on suit est celle de l'onglet qu'on a quitté.
  const back = projects.find((project) => project.root === root)?.scripts.back.tab;
  return (tabs.find((entry) => entry.info.id === activeTerminalId) ?? tabs.find((entry) => entry.info.id === back) ?? tabs[0])
    ?.info.id;
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

/**
 * Écrit dans l'onglet actif du projet actif, pour insérer un chemin par exemple.
 * Rien si l'onglet actif appartient à un autre projet : on taperait chez lui.
 */
export function typeIntoActive(data: string): string | undefined {
  const { terminals, activeTerminalId, activeRoot } = getState();
  const id = ownActiveTab(terminals, activeTerminalId, activeRoot);
  return id && typeAsUser(id, data) ? id : undefined;
}

/** Écrit dans un terminal désigné, sans condition : c'est Clide qui y tape. */
export function typeInto(id: string, data: string): void {
  send({ t: "input", id, data });
}

/**
 * Un terminal de script n'accepte la frappe que pendant que son script tourne :
 * elle va alors au programme — une question Y/n, les touches d'un serveur de
 * développement, Ctrl+C. Revenu au prompt, il la refuse : sa ligne de commande
 * n'est pas un shell où travailler, et ce qu'on y lancerait, `claude` le premier,
 * n'aurait plus rien du script. Relancer passe par ▷.
 */
export function acceptsInput(id: string): boolean {
  const info = getState().terminals[id]?.info;
  return !info || !info.script || info.kind !== "shell" || info.state === "running";
}

let refusedTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Écrit dans un terminal ce que l'utilisateur y tape, colle ou dépose. Faux, et
 * le cadre le rappelle un instant, quand un script fini le refuse ; les réponses
 * de xterm au programme passent toujours.
 */
export function typeAsUser(id: string, data: string): boolean {
  if (!acceptsInput(id) && !isTerminalReply(data)) {
    setState({ refusedInput: id });
    clearTimeout(refusedTimer);
    refusedTimer = setTimeout(() => setState({ refusedInput: null }), 3000);
    return false;
  }
  typeInto(id, data);
  return true;
}

/** L'hôte a une taille : masqué (`display: none`), il mesure zéro. */
function measurable(entry: Attached): boolean {
  return entry.host.clientWidth > 0 && entry.host.clientHeight > 0;
}

/**
 * Taille du terminal qu'on voit, celle que prend un terminal qui s'ouvre ou se
 * monte caché : sa sortie s'écrit à la largeur où on la lira. Aucune si aucun
 * terminal n'est visible.
 */
function visibleSize(): { cols: number; rows: number } | undefined {
  const { activeTerminalId } = getState();
  const active = activeTerminalId ? attached.get(activeTerminalId) : undefined;
  const entry = active && measurable(active) ? active : [...attached.values()].find(measurable);
  return entry ? { cols: entry.term.cols, rows: entry.term.rows } : undefined;
}

/**
 * Ajuste un terminal à son hôte et en prévient le serveur.
 *
 * Rien pour un terminal masqué : ajusté à un hôte qui mesure zéro, il prendrait
 * une taille minuscule, et ConPTY, redimensionné à elle, ne garderait que ce
 * qui tient dans cet écran — la sortie serait perdue au premier affichage. Il
 * s'ajuste quand on le montre.
 */
export function resize(id: string, options: { focus?: boolean } = {}): void {
  const entry = attached.get(id);
  if (!entry || !measurable(entry)) return;
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
    // L'interface peut être agrandie par le zoom d'Electron : le terminal garde sa taille.
    fontSize: terminalFont.size / nativeZoom(),
    cursorBlink: true,
    // Assez pour remonter une session entière en mode inline, où Claude Code
    // écrit la conversation dans l'historique du terminal.
    scrollback: 10_000,
    theme,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host);
  term.onData((data) => typeAsUser(info.id, data));
  attached.set(info.id, { term, fit, host });
  // Monté caché, il ne peut pas s'ajuster : il prend la taille du terminal qu'on
  // voit, celle où le serveur l'a ouvert, plutôt que les 80x24 de xterm.
  const size = host.clientWidth > 0 ? undefined : visibleSize();
  if (size) term.resize(size.cols, size.rows);
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
// L'échelle de l'interface change : la taille compensée du terminal suit.
onZoomChange(() => applyTerminalFont(getState().terminalFont));

export function applyTerminalFont(font: TerminalFont): void {
  for (const entry of attached.values()) {
    entry.term.options.fontFamily = fontStack(font.family);
    entry.term.options.fontSize = font.size / nativeZoom();
  }
  // Sans reprendre le focus : le réglage se fait depuis un champ qu'il ne faut
  // pas quitter à chaque chiffre tapé.
  const { activeTerminalId } = getState();
  if (activeTerminalId) resize(activeTerminalId, { focus: false });
}

export function applyTerminalTheme(theme: Record<string, string>): void {
  for (const entry of attached.values()) entry.term.options.theme = theme;
}
