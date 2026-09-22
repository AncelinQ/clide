// Client de claude-ide. Aucun outil de construction : le navigateur charge ce
// module tel quel, xterm.js arrive par balise script depuis /vendor.

const TOKEN = new URLSearchParams(location.search).get("token") ?? "";

const el = {
  projectRoot: document.querySelector("#project-root"),
  openShell: document.querySelector("#open-shell"),
  openClaude: document.querySelector("#open-claude"),
  connection: document.querySelector("#connection"),
  sessions: document.querySelector("#sessions"),
  sessionFilter: document.querySelector("#session-filter"),
  refreshSessions: document.querySelector("#refresh-sessions"),
  tabs: document.querySelector("#tabs"),
  terminals: document.querySelector("#terminals"),
  status: document.querySelector("#status"),
  detail: document.querySelector("#detail"),
  detailTitle: document.querySelector("#detail-title"),
  detailTabs: document.querySelector("#detail-tabs"),
  detailRefresh: document.querySelector("#detail-refresh"),
};

/** @type {Map<string, {info: object, term: any, fit: any, host: HTMLElement, tab: HTMLElement}>} */
const terminals = new Map();
let activeId = null;
let sessions = [];
let selectedSession = null;
let socket = null;
/** Onglets en attente d'un regard, par identifiant de terminal. */
const attention = new Map();

// ─── API ────────────────────────────────────────────────────────────────────

function apiUrl(path, params = {}) {
  const url = new URL(path, location.origin);
  url.searchParams.set("token", TOKEN);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  }
  return url;
}

async function api(path, params = {}, options = {}) {
  const response = await fetch(apiUrl(path, params), options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

// ─── Fabriques d'éléments ───────────────────────────────────────────────────

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function row(name, sub, tags = []) {
  const item = node("li");
  const line = node("span", "name");
  for (const tag of tags) line.append(node("span", `tag ${tag.tone ?? ""}`, tag.label), " ");
  line.append(name);
  item.append(line);
  if (sub) item.append(node("span", "sub", sub));
  return item;
}

function list(items) {
  const ul = node("ul", "rows");
  for (const item of items) ul.append(item);
  return ul;
}

function empty(text) {
  return node("p", "empty", text);
}

// ─── Terminaux ──────────────────────────────────────────────────────────────

function setConnection(state, label) {
  el.connection.textContent = label;
  el.connection.className = `pill ${state}`;
}

function connect() {
  const url = new URL("/pty", location.origin);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", TOKEN);

  socket = new WebSocket(url);
  socket.addEventListener("open", () => setConnection("on", "connecté"));
  socket.addEventListener("close", () => {
    setConnection("off", "déconnecté — reconnexion…");
    setTimeout(connect, 1500);
  });
  socket.addEventListener("message", (event) => onServerMessage(JSON.parse(event.data)));
}

function post(message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function onServerMessage(message) {
  switch (message.t) {
    case "opened":
      createTerminalView(message.terminal);
      break;
    case "data":
      terminals.get(message.id)?.term.write(message.data);
      break;
    case "state": {
      const entry = terminals.get(message.terminal.id);
      if (entry) {
        entry.info = message.terminal;
        renderTab(entry);
        if (message.terminal.id === activeId) renderStatus(message.terminal);
      }
      break;
    }
    case "exit": {
      const entry = terminals.get(message.id);
      if (entry) entry.term.write(`\r\n\u001b[90m— terminal fermé (${message.exitCode}) —\u001b[0m\r\n`);
      break;
    }
    case "notification":
      onNotification(message.notification, message.terminalId);
      break;
    case "error":
      console.error("[claude-ide]", message.message);
      break;
  }
}

function createTerminalView(info) {
  const host = node("div", "term");
  el.terminals.append(host);

  const term = new window.Terminal({
    fontFamily: 'Consolas, "Cascadia Mono", monospace',
    fontSize: 13,
    cursorBlink: true,
    theme: { background: "#101216", foreground: "#dfe3ea" },
  });
  const fit = new window.FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(host);
  term.onData((data) => post({ t: "input", id: info.id, data }));

  attachFileDrop(host, info.id);

  const tab = node("div", "tab");
  el.tabs.append(tab);

  const entry = { info, term, fit, host, tab };
  terminals.set(info.id, entry);

  tab.addEventListener("click", (event) => {
    if (event.target.dataset.action === "close") {
      post({ t: "close", id: info.id });
      disposeTerminal(info.id);
      return;
    }
    activate(info.id);
  });

  renderTab(entry);
  activate(info.id);
}

/**
 * Écrit le chemin d'un fichier déposé dans le terminal.
 *
 * Le chemin d'origine n'est connu que sous Electron : un navigateur livre le
 * contenu d'un fichier déposé, jamais son emplacement. Hors application de
 * bureau, le dépôt est donc laissé au navigateur plutôt que de coller un nom de
 * fichier qui ne désigne rien.
 *
 * Le chemin est entouré de guillemets : les dossiers de projet portent des
 * espaces, et un chemin nu se couperait en deux arguments.
 */
function attachFileDrop(host, terminalId) {
  if (!desktop) return;

  host.addEventListener("dragover", (event) => {
    event.preventDefault();
    host.classList.add("dropping");
  });
  host.addEventListener("dragleave", () => host.classList.remove("dropping"));
  host.addEventListener("drop", (event) => {
    event.preventDefault();
    host.classList.remove("dropping");

    const chemins = [...(event.dataTransfer?.files ?? [])]
      .map((file) => desktop.pathForFile(file))
      .filter(Boolean)
      .map((chemin) => (chemin.includes(" ") ? `"${chemin}"` : chemin));

    if (chemins.length > 0) post({ t: "input", id: terminalId, data: `${chemins.join(" ")} ` });
  });
}

function disposeTerminal(id) {
  const entry = terminals.get(id);
  if (!entry) return;
  entry.term.dispose();
  entry.host.remove();
  entry.tab.remove();
  terminals.delete(id);
  if (activeId === id) {
    const next = terminals.keys().next();
    activeId = null;
    if (next.done) renderStatus(null);
    else activate(next.value);
  }
}

function renderTab({ info, tab }) {
  tab.classList.toggle("active", info.id === activeId);
  const close = node("span", "close", "×");
  close.dataset.action = "close";

  const waiting = attention.get(info.id);
  const children = [node("span", `dot ${info.state}`), node("span", null, info.title)];
  if (waiting) children.push(node("span", `bell ${waiting}`, "●"));
  children.push(close);
  tab.replaceChildren(...children);
}

function activate(id) {
  activeId = id;
  // Regarder l'onglet vaut acquittement : l'attente n'a plus lieu d'être.
  attention.delete(id);
  renderBadge();
  for (const entry of terminals.values()) {
    const isActive = entry.info.id === id;
    entry.host.classList.toggle("active", isActive);
    renderTab(entry);
    if (isActive) {
      requestAnimationFrame(() => {
        entry.fit.fit();
        post({ t: "resize", id, cols: entry.term.cols, rows: entry.term.rows });
        entry.term.focus();
      });
      renderStatus(entry.info);
    }
  }
}

function renderStatus(info) {
  if (!info) {
    el.status.textContent = "";
    return;
  }
  const bits = [info.cwd, info.kind, info.state];
  if (info.lastExitCode !== undefined) bits.push(`sortie ${info.lastExitCode}`);
  el.status.textContent = bits.join("   ·   ");
}

function projectRoot() {
  return el.projectRoot.value.trim();
}

function openTerminal(kind, initialCommand) {
  const root = projectRoot();
  if (!root) {
    el.projectRoot.focus();
    return;
  }
  localStorage.setItem("claude-ide.projectRoot", root);
  post({
    t: "open",
    projectRoot: root,
    kind,
    cols: 100,
    rows: 30,
    ...(initialCommand ? { initialCommand } : {}),
  });
}


// ─── Formulaires ────────────────────────────────────────────────────────────

function input(placeholder, value = "") {
  const control = node("input");
  control.placeholder = placeholder;
  control.value = value;
  control.spellcheck = false;
  return control;
}

function textarea(value = "", rows = 12) {
  const control = node("textarea");
  control.value = value;
  control.rows = rows;
  control.spellcheck = false;
  return control;
}

function select(options, value) {
  const control = node("select");
  for (const [key, label] of options) {
    const option = node("option", null, label);
    option.value = key;
    if (key === value) option.selected = true;
    control.append(option);
  }
  return control;
}

function labeled(label, control) {
  const wrapper = node("label", "field");
  wrapper.append(node("span", null, label), control);
  return wrapper;
}

function form(...children) {
  const box = node("div", "form");
  box.append(...children);
  return box;
}

/**
 * Enveloppe une action qui écrit : bouton désactivé le temps de l'aller-retour,
 * message d'erreur rendu à côté plutôt qu'avalé dans la console.
 */
function onAction(button, run) {
  button.type = "button";
  button.addEventListener("click", async () => {
    const label = button.textContent;
    button.disabled = true;
    button.textContent = "…";
    const previous = button.parentElement?.querySelector(".form-error");
    previous?.remove();
    try {
      await run();
    } catch (error) {
      button.parentElement?.append(node("span", "form-error", error.message));
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  });
  return button;
}

/**
 * Bouton de suppression en deux temps.
 *
 * Une confirmation modale bloquerait la page et n'apporterait rien : demander
 * un second clic suffit à écarter le geste involontaire, sans interrompre.
 */
function dangerButton(label, run) {
  const button = node("button", "stop", label);
  button.type = "button";
  let armed = false;
  button.addEventListener("click", async () => {
    if (!armed) {
      armed = true;
      button.textContent = "confirmer ?";
      setTimeout(() => {
        if (!armed) return;
        armed = false;
        button.textContent = label;
      }, 4000);
      return;
    }
    armed = false;
    button.disabled = true;
    try {
      await run();
    } catch (error) {
      button.disabled = false;
      button.textContent = error.message;
    }
  });
  return button;
}

/** Appel d'une route qui écrit. `post` est déjà l'envoi WebSocket. */
function postJson(path, body) {
  return api(path, {}, { method: "POST", body: JSON.stringify(body) });
}

// ─── Notifications ──────────────────────────────────────────────────────────

const NOTIFICATION_LABEL = {
  permission: "permission demandée",
  idle: "en attente d'une réponse",
  stop: "réponse terminée",
  other: "événement",
};

/** Historique côté client, pour que le panneau reste vivant sans requête. */
const notifications = [];

/** Pont vers l'application de bureau. Absent dans un navigateur ordinaire. */
const desktop = window.claudeIde;

function renderBadge() {
  // Le titre de l'onglet du navigateur est le seul endroit visible quand la
  // fenêtre est en arrière-plan.
  document.title = attention.size > 0 ? `(${attention.size}) claude-ide` : "claude-ide";
  // Sous Electron, le bouton de la barre des tâches clignote en plus.
  desktop?.setAttention(attention.size);
}

function onNotification(notification, terminalId) {
  notifications.unshift(notification);
  if (notifications.length > 100) notifications.pop();

  if (terminalId && terminalId !== activeId) {
    attention.set(terminalId, notification.kind);
    const entry = terminals.get(terminalId);
    if (entry) renderTab(entry);
    renderBadge();
  }

  // Une notification système n'a de sens que si la page n'est pas sous les yeux.
  if (document.hidden && window.Notification?.permission === "granted") {
    const title = NOTIFICATION_LABEL[notification.kind] ?? NOTIFICATION_LABEL.other;
    const body = notification.message ?? notification.cwd ?? "";
    const system = new Notification(`claude-ide — ${title}`, { body, tag: notification.kind });
    system.onclick = () => {
      window.focus();
      if (terminalId) activate(terminalId);
      system.close();
    };
  }

  if (activePanel === "notifications") void showPanel("notifications");
}

async function loadNotifications() {
  const { status, recent } = await api("/api/notifications");
  // Le serveur garde l'historique des événements reçus avant l'ouverture de
  // cette page ; le client y ajoute ceux arrivés depuis.
  const seen = new Set(notifications.map((item) => item.id));
  const all = [...notifications, ...recent.filter((item) => !seen.has(item.id))];

  const container = node("div");

  const state = node("p", "empty");
  state.append(
    status.installed
      ? node("span", "tag ok", "hooks installés")
      : node("span", "tag warn", status.kinds.length > 0 ? "installation partielle" : "hooks absents"),
    " ",
    status.installed
      ? "Claude Code signale les permissions, les attentes et les fins de réponse."
      : "Sans eux, aucun événement ne remonte.",
  );
  container.append(state);

  const actions = node("div");
  const toggle = node("button", null, status.installed ? "Désinstaller les hooks" : "Installer les hooks");
  toggle.type = "button";
  toggle.title = status.settingsPath;
  toggle.addEventListener("click", async () => {
    toggle.disabled = true;
    try {
      await postJson(status.installed ? "/api/notifications/uninstall" : "/api/notifications/install", {});
      await requestSystemPermission();
      await showPanel("notifications");
    } catch (error) {
      toggle.textContent = error.message;
    }
  });
  actions.append(toggle);
  container.append(actions);

  if (all.length === 0) {
    container.append(empty("aucun événement reçu."));
    return container;
  }

  container.append(
    list(
      all.slice(0, 60).map((item) => {
        const when = new Date(item.receivedAt).toLocaleTimeString("fr-FR");
        const where = (item.cwd ?? "").split(/[\/]/).pop() ?? "";
        return row(item.message ?? NOTIFICATION_LABEL[item.kind], [when, where].filter(Boolean).join("  ·  "), [
          { label: NOTIFICATION_LABEL[item.kind], tone: item.kind === "permission" ? "warn" : "" },
        ]);
      }),
    ),
  );
  return container;
}

/** Demande l'autorisation système, sans insister si elle est refusée. */
async function requestSystemPermission() {
  if (!window.Notification || Notification.permission !== "default") return;
  try {
    await Notification.requestPermission();
  } catch {
    // Refus ou navigateur sans notifications : la pastille d'onglet suffit.
  }
}

// ─── Sessions ───────────────────────────────────────────────────────────────

async function loadSessions() {
  el.sessions.replaceChildren(node("li", "empty", "indexation…"));
  try {
    sessions = (await api("/api/sessions")).sessions;
    renderSessions();
  } catch (error) {
    el.sessions.replaceChildren(node("li", "empty", error.message));
  }
}

function renderSessions() {
  const needle = el.sessionFilter.value.trim().toLowerCase();
  const shown = sessions.filter((session) =>
    needle
      ? `${session.title ?? ""} ${session.effectiveCwd ?? ""} ${session.gitBranch ?? ""}`
          .toLowerCase()
          .includes(needle)
      : true,
  );

  if (shown.length === 0) {
    el.sessions.replaceChildren(node("li", "empty", "aucune session"));
    return;
  }

  el.sessions.replaceChildren(
    ...shown.slice(0, 200).map((session) => {
      const item = node("li");
      item.dataset.id = session.sessionId;
      const when = session.lastActivityAt
        ? new Date(session.lastActivityAt).toLocaleString("fr-FR")
        : "";
      const folder = (session.effectiveCwd ?? "").split(/[\\/]/).pop() ?? "";
      item.append(
        node("span", "title", session.title ?? session.lastPrompt ?? session.sessionId.slice(0, 8)),
        node(
          "span",
          "meta",
          [when, folder, session.gitBranch, `${session.fileCount} fichiers`].filter(Boolean).join("  ·  "),
        ),
      );
      item.addEventListener("click", () => selectSession(session));
      return item;
    }),
  );
}

function selectSession(session) {
  selectedSession = session;
  for (const item of el.sessions.children) {
    item.classList.toggle("selected", item.dataset.id === session.sessionId);
  }
  if (session.effectiveCwd) el.projectRoot.value = session.effectiveCwd;
  showPanel(activePanel);
}

// ─── Panneaux ───────────────────────────────────────────────────────────────

const PANELS = [
  { id: "files", label: "Fichiers", scope: "session", load: loadFiles },
  { id: "activity", label: "Activité", scope: "session", load: loadActivity },
  { id: "skills", label: "Skills", scope: "project", load: loadSkills },
  { id: "mcp", label: "MCP", scope: "project", load: loadMcp },
  { id: "scripts", label: "Scripts", scope: "project", load: loadScripts },
  { id: "links", label: "Liens", scope: "project", load: loadLinks },
  { id: "worktrees", label: "Worktrees", scope: "project", load: loadWorktrees },
  { id: "settings", label: "Réglages", scope: "global", load: loadSettings },
  { id: "processes", label: "Process", scope: "global", load: loadProcesses },
  { id: "notifications", label: "Notifications", scope: "global", load: loadNotifications },
  { id: "plan", label: "Plan", scope: "session", load: loadPlan },
];

let activePanel = "files";

function renderPanelTabs() {
  el.detailTabs.replaceChildren(
    ...PANELS.map((panel) => {
      const button = node("button", `subtab ${panel.id === activePanel ? "active" : ""}`, panel.label);
      button.type = "button";
      button.addEventListener("click", () => showPanel(panel.id));
      return button;
    }),
  );
}

async function showPanel(id) {
  activePanel = id;
  renderPanelTabs();
  const panel = PANELS.find((candidate) => candidate.id === id);
  el.detailTitle.textContent = panel.label;

  if (panel.scope === "session" && !selectedSession) {
    el.detail.replaceChildren(empty("Choisis une session à gauche."));
    return;
  }
  if (panel.scope === "project" && !projectRoot()) {
    el.detail.replaceChildren(empty("Indique un dossier de projet en haut."));
    return;
  }

  el.detail.replaceChildren(empty("chargement…"));
  try {
    el.detail.replaceChildren(await panel.load());
  } catch (error) {
    el.detail.replaceChildren(empty(error.message));
  }
}

async function loadFiles() {
  const { diffs } = await api("/api/session/files", { id: selectedSession.sessionId });
  if (!diffs?.length) return empty("aucun fichier touché.");

  const container = node("div");
  for (const diff of diffs) {
    const block = node("div", "file");
    block.append(node("h3", null, diff.trackingPath));

    const tags = [];
    if (diff.created) tags.push("créé");
    if (diff.deleted) tags.push("supprimé");
    if (diff.binary) tags.push("binaire");
    if (diff.beforeMissing) tags.push("sauvegarde absente");

    const counts = node("div", "counts");
    counts.append(
      node("span", "add", `+${diff.linesAdded}`),
      " ",
      node("span", "del", `−${diff.linesRemoved}`),
      tags.length ? `  ·  ${tags.join(", ")}` : "",
    );
    block.append(counts);

    if (diff.unified) {
      const pre = node("pre", "diff");
      for (const line of diff.unified.split("\n")) {
        const cls = line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : line.startsWith("@@") ? "hunk" : null;
        pre.append(node("span", cls, `${line}\n`));
      }
      block.append(pre);
    }
    container.append(block);
  }
  return container;
}

const ACTIVITY_LABEL = {
  prompt: "moi",
  command: "commande",
  answer: "claude",
  tool: "outil",
  note: "note",
};

async function loadActivity() {
  const feed = await api("/api/session/activity", { id: selectedSession.sessionId, limit: 300 });
  if (!feed.entries?.length) return empty("aucune activité.");

  const container = node("div");
  if (feed.total > feed.entries.length) {
    container.append(
      empty(`${feed.entries.length} dernières entrées sur ${feed.total}.`),
    );
  }

  const ul = node("ul", "feed");
  for (const entry of feed.entries) {
    const item = node("li", `${entry.kind}${entry.failed ? " failed" : ""}`);
    item.append(
      node("span", "who", entry.kind === "tool" ? entry.name : ACTIVITY_LABEL[entry.kind]),
      node("span", "what", entry.kind === "tool" ? entry.summary : entry.text),
    );
    if (entry.at) item.title = new Date(entry.at).toLocaleString("fr-FR");
    ul.append(item);
  }
  container.append(ul);
  return container;
}

async function loadSkills() {
  const root = projectRoot();
  const { skills, commands } = await api("/api/skills", { root });
  const container = node("div");

  container.append(node("h3", null, `Skills (${skills.length})`));
  container.append(
    skills.length
      ? list(skills.map((skill) => skillRow(skill, root)))
      : empty("aucun skill."),
  );

  const nouveau = node("button", null, "Nouveau skill");
  onAction(nouveau, async () => {
    el.detail.replaceChildren(skillForm({ scope: "user", directory: "", body: "" }, root));
  });
  container.append(node("div", "actions", ""), nouveau);

  container.append(node("h3", null, `Commandes (${commands.length})`));
  container.append(
    commands.length
      ? list(commands.map((command) => row(`/${command.name}`, command.description)))
      : empty("aucune commande."),
  );
  return container;
}

function skillRow(skill, root) {
  const item = row(skill.name, skill.description, [
    { label: skill.scope === "project" ? "projet" : "perso" },
    ...(skill.invocation === "auto-and-slash" ? [] : [{ label: skill.invocation, tone: "warn" }]),
  ]);

  const actions = node("div", "actions");
  const editer = node("button", "run", "éditer");
  onAction(editer, async () => {
    // Le corps n'est pas dans la liste : il est relu au moment de l'ouvrir,
    // pour ne pas charger tous les skills en entier à chaque affichage.
    const { raw } = await api("/api/skill", {
      scope: skill.scope,
      directory: skill.directory,
      ...(skill.scope === "project" ? { root } : {}),
    });
    el.detail.replaceChildren(
      skillForm({ ...skill, directory: skill.directory, body: stripFrontmatter(raw) }, root),
    );
  });
  actions.append(editer);
  actions.append(
    dangerButton("supprimer", async () => {
      await postJson("/api/skills/remove", {
        scope: skill.scope,
        directory: skill.directory,
        ...(skill.scope === "project" ? { root } : {}),
      });
      await showPanel("skills");
    }),
  );
  item.append(actions);
  return item;
}

/** Retire l'en-tête : le formulaire l'édite par ses champs, pas par le texte. */
function stripFrontmatter(raw) {
  if (!raw.startsWith("---")) return raw;
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return raw;
  return raw.slice(raw.indexOf("\n", end + 1) + 1).replace(/^\n+/, "");
}

function skillForm(skill, root) {
  const directory = input("nom du dossier", skill.directory ?? "");
  const nom = input("nom déclaré, celui de /nom", skill.name ?? "");
  const description = input("quand Claude doit s'en servir", skill.description ?? "");
  const invocation = select(
    [
      ["auto-and-slash", "automatique et /nom"],
      ["manual-only", "seulement /nom"],
      ["auto-only", "seulement automatique"],
    ],
    skill.invocation ?? "auto-and-slash",
  );
  const scope = select(
    [
      ["user", "perso (~/.claude/skills)"],
      ["project", "projet (.claude/skills)"],
    ],
    skill.scope ?? "user",
  );
  const corps = textarea(skill.body ?? "", 14);

  const enregistrer = node("button", "accent", "Enregistrer");
  onAction(enregistrer, async () => {
    await postJson("/api/skills/save", {
      scope: scope.value,
      directory: directory.value,
      name: nom.value,
      description: description.value,
      invocation: invocation.value,
      body: corps.value,
      ...(scope.value === "project" ? { root } : {}),
    });
    await showPanel("skills");
  });

  const annuler = node("button", null, "Annuler");
  onAction(annuler, async () => showPanel("skills"));

  return form(
    labeled("dossier", directory),
    labeled("nom", nom),
    labeled("description", description),
    labeled("invocation", invocation),
    labeled("portée", scope),
    labeled("contenu", corps),
    actions(enregistrer, annuler),
  );
}

function actions(...children) {
  const box = node("div", "actions");
  box.append(...children);
  return box;
}

async function loadMcp() {
  const root = projectRoot();
  const { servers } = await api("/api/mcp", { root });
  const container = node("div");

  container.append(
    servers.length
      ? list(servers.map((server) => mcpRow(server, root)))
      : empty("aucun serveur MCP."),
  );

  container.append(node("h3", null, "Ajouter au projet"));
  // Seule la portée projet s'écrit : `~/.claude.json` porte aussi l'historique
  // de chaque projet, et passe par la CLI `claude mcp`.
  container.append(empty("Les portées perso et locale passent par `claude mcp`."));

  const nom = input("nom du serveur");
  const cible = input("https://… ou une commande à lancer");
  const ajouter = node("button", "accent", "Ajouter");
  onAction(ajouter, async () => {
    const valeur = cible.value.trim();
    const config = valeur.startsWith("http")
      ? { type: "http", url: valeur }
      : { command: valeur.split(/\s+/)[0], args: valeur.split(/\s+/).slice(1) };
    await postJson("/api/mcp/save", { root, name: nom.value, config });
    await showPanel("mcp");
  });

  container.append(form(labeled("nom", nom), labeled("cible", cible), actions(ajouter)));
  return container;
}

function mcpRow(server, root) {
  const target = server.url ?? [server.command, ...(server.args ?? [])].join(" ");
  const keys = [...Object.keys(server.headers ?? {}), ...Object.keys(server.env ?? {})];
  const sub = [target, keys.length ? `secrets masqués : ${keys.join(", ")}` : ""]
    .filter(Boolean)
    .join("  ·  ");

  const item = row(server.name, sub, [{ label: server.scope }, { label: server.transport }]);
  if (server.scope === "project") {
    item.append(
      actions(
        dangerButton("retirer", async () => {
          await postJson("/api/mcp/remove", { root, name: server.name });
          await showPanel("mcp");
        }),
      ),
    );
  }
  return item;
}

async function loadScripts() {
  const project = await api("/api/scripts", { root: projectRoot() });
  const container = node("div");
  container.append(
    empty(
      `${project.manager}${project.managerDetected ? "" : " (défaut — aucun lockfile)"}  ·  ${project.sources.length} paquet(s)`,
    ),
  );

  for (const source of project.sources) {
    container.append(node("h3", null, source.packageName ?? source.relativePath ?? "racine"));
    if (!source.scripts.length) {
      container.append(empty("aucun script."));
      continue;
    }
    container.append(
      list(
        source.scripts.map((script) => {
          const item = row("", script.command);
          const button = node("button", "run", script.name);
          button.type = "button";
          button.title = "Lancer dans un nouveau terminal";
          button.addEventListener("click", () => {
            const command = project.manager === "npm" ? `npm run ${script.name}` : `${project.manager} run ${script.name}`;
            el.projectRoot.value = source.directory;
            openTerminal("shell", command);
          });
          item.querySelector(".name").prepend(button);
          return item;
        }),
      ),
    );
  }
  return container;
}

async function loadLinks() {
  const root = projectRoot();
  const { links } = await api("/api/links", { root });
  const container = node("div");

  const save = async (next) => {
    await postJson("/api/links/save", { root, links: next });
    await showPanel("links");
  };

  container.append(
    links.length
      ? list(
          links.map((link) => {
            const item = row(link.path, link.role, link.readOnly ? [{ label: "lecture seule", tone: "warn" }] : []);
            const bascule = node("button", "run", link.readOnly ? "rendre modifiable" : "passer en lecture seule");
            onAction(bascule, () =>
              save(links.map((l) => (l.path === link.path ? { ...l, readOnly: !l.readOnly } : l))),
            );
            item.append(
              actions(
                bascule,
                dangerButton("délier", () => save(links.filter((l) => l.path !== link.path))),
              ),
            );
            return item;
          }),
        )
      : empty("aucun dossier lié."),
  );

  const chemin = input("C:\\Projets\\autre-depot");
  const role = input("son rôle : api, design system…");
  const lecture = select(
    [
      ["non", "Claude peut y écrire"],
      ["oui", "lecture seule"],
    ],
    "non",
  );
  const ajouter = node("button", "accent", "Lier ce dossier");
  onAction(ajouter, () =>
    save([
      ...links.filter((l) => l.path !== chemin.value.trim()),
      { path: chemin.value.trim(), role: role.value, readOnly: lecture.value === "oui" },
    ]),
  );

  container.append(node("h3", null, "Lier un dossier"));
  container.append(
    form(labeled("chemin", chemin), labeled("rôle", role), labeled("accès", lecture), actions(ajouter)),
  );
  return container;
}

async function loadSettings() {
  const document_ = await api("/api/settings");
  const container = node("div");
  container.append(empty(document_.path));

  const texte = textarea(document_.raw, 22);
  const enregistrer = node("button", "accent", "Enregistrer");
  onAction(enregistrer, async () => {
    // Le serveur analyse avant d'écrire : un JSON invalide revient en erreur
    // plutôt que de remplacer une configuration qui marche.
    await postJson("/api/settings/replace", { raw: texte.value });
    await showPanel("settings");
  });
  const recharger = node("button", null, "Recharger");
  onAction(recharger, async () => showPanel("settings"));

  container.append(
    empty("Une sauvegarde de l'original est posée avant la première modification."),
  );
  container.append(form(texte, actions(enregistrer, recharger)));
  return container;
}

async function loadWorktrees() {
  const root = projectRoot();
  const { worktrees } = await api("/api/worktrees", { root });
  if (!worktrees.length) return empty("ce dossier n'est pas un dépôt git, ou git est absent.");

  const container = node("div");
  for (const worktree of worktrees) {
    const tags = [];
    if (worktree.main) tags.push({ label: "dépôt principal" });
    if (worktree.detached) tags.push({ label: "HEAD détaché", tone: "warn" });
    if (worktree.locked !== undefined) tags.push({ label: "verrouillé", tone: "warn" });
    if (worktree.prunable !== undefined) tags.push({ label: "à élaguer", tone: "warn" });
    if (worktree.dirty > 0) tags.push({ label: `${worktree.dirty} non commité(s)`, tone: "warn" });

    const suite = [];
    if (worktree.ahead || worktree.behind) suite.push(`↑${worktree.ahead ?? 0} ↓${worktree.behind ?? 0}`);
    suite.push(worktree.path);
    if (worktree.sessions.length) suite.push(`${worktree.sessions.length} session(s)`);

    const item = row(worktree.branch ?? worktree.head?.slice(0, 8) ?? "?", suite.join("  ·  "), tags);

    const ouvrir = node("button", "run", "ouvrir un terminal");
    onAction(ouvrir, async () => {
      el.projectRoot.value = worktree.path;
      openTerminal("shell");
    });

    const boutons = [ouvrir];
    if (!worktree.main) {
      boutons.push(
        dangerButton("retirer", async () => {
          await postJson("/api/worktrees/remove", { root, path: worktree.path });
          await showPanel("worktrees");
        }),
      );
    }
    item.append(actions(...boutons));

    // Les sessions du worktree se retrouvent depuis la liste de gauche ; les
    // nommer ici dit surtout si le worktree est encore vivant.
    if (worktree.sessions.length) {
      const dernière = worktree.sessions[0];
      item.append(
        node(
          "span",
          "sub",
          `dernière session : ${dernière.title ?? dernière.sessionId.slice(0, 8)}`,
        ),
      );
    }
    container.append(list([item]));
  }
  return container;
}

async function loadProcesses() {
  const { tree } = await api("/api/processes");
  if (!tree.length) return empty("aucun processus Claude en cours.");

  const render = (nodes, isRoot) => {
    const ul = node("ul", `tree ${isRoot ? "root" : ""}`);
    for (const item of nodes) {
      const li = node("li");
      const line = node("span", "name");

      const tone = item.link.kind === "owned" ? "ok" : item.link.kind === "inferred" ? "warn" : "";
      const label =
        item.link.kind === "owned" ? "ce terminal" : item.link.kind === "inferred" ? "lancé ailleurs" : "enfant";
      line.append(node("span", `tag ${tone}`, label), " ", `${item.name} · ${item.pid}`);

      if (item.link.kind !== "orphan") {
        const stop = node("button", "stop", "arrêter");
        stop.type = "button";
        stop.addEventListener("click", async () => {
          stop.disabled = true;
          try {
            await api("/api/processes/stop", { pid: item.pid }, { method: "POST" });
            await showPanel("processes");
          } catch (error) {
            stop.textContent = error.message;
          }
        });
        line.append(" ", stop);
      }

      li.append(line);
      if (item.commandLine) li.append(node("span", "sub", item.commandLine));
      li.append(node("span", "sub", `${item.memoryMB} Mo`));
      if (item.children.length) li.append(render(item.children, false));
      ul.append(li);
    }
    return ul;
  };

  return render(tree, true);
}

async function loadPlan() {
  const { plan, mode, planModeEntries } = await api("/api/session/plan", {
    id: selectedSession.sessionId,
  });

  if (!plan) {
    const container = node("div");
    container.append(
      empty(
        planModeEntries > 0
          ? "Cette session est passée en mode plan mais n'a jamais soumis de plan."
          : "Cette session n'est jamais passée en mode plan.",
      ),
    );
    // Claude Code n'écrit plus de fichier de plan : le seul endroit où il
    // apparaisse est l'appel qui le soumet. Le dire évite de chercher ailleurs.
    container.append(
      empty(`Mode courant : ${mode ?? "inconnu"}. Le plan est lu dans l'appel à ExitPlanMode.`),
    );
    return container;
  }

  const container = node("div");
  if (plan.progress) {
    const { done, total } = plan.progress;
    container.append(empty(`${done} sur ${total} étapes cochées`));
  }
  if (plan.at) container.append(empty(new Date(plan.at).toLocaleString("fr-FR")));
  container.append(node("pre", "diff", plan.text));
  return container;
}

// ─── Démarrage ──────────────────────────────────────────────────────────────

el.openShell.addEventListener("click", () => openTerminal("shell"));
el.openClaude.addEventListener("click", () => openTerminal("claude", "claude"));
el.refreshSessions.addEventListener("click", () => void loadSessions());
el.sessionFilter.addEventListener("input", renderSessions);
el.detailRefresh.addEventListener("click", () => void showPanel(activePanel));

el.projectRoot.value = localStorage.getItem("claude-ide.projectRoot") ?? "";

window.addEventListener("resize", () => {
  const entry = terminals.get(activeId);
  if (!entry) return;
  entry.fit.fit();
  post({ t: "resize", id: activeId, cols: entry.term.cols, rows: entry.term.rows });
});

renderPanelTabs();
connect();
void loadSessions();
