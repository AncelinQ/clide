// Client de claude-ide. Aucun outil de construction : le navigateur charge ce
// module tel quel, xterm.js arrive par balise script depuis /vendor.
//
// Disposition reprise de ClaudeTerm : gauche = le projet, centre = la session,
// droite = ce qui ne dépend d'aucun projet.

const TOKEN = new URLSearchParams(location.search).get("token") ?? "";
/** Pont vers l'application de bureau. Absent dans un navigateur ordinaire. */
const desktop = window.claudeIde;

const el = {};
for (const id of [
  "toggle-left", "toggle-right", "project-tabs", "add-project", "connection",
  "crumbs", "files", "left-modes", "left-panel",
  "tabs", "open-shell", "open-claude", "terminals", "status",
  "welcome", "welcome-title", "welcome-path", "welcome-claude", "welcome-shell",
  "session-modes", "session-panel",
  "global-tabs", "global-filter", "global-refresh", "global-panel",
]) {
  el[id.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = document.querySelector(`#${id}`);
}

// ─── Thème ──────────────────────────────────────────────────────────────────

/**
 * Trois réglages : suivre le système, forcer le clair, forcer le sombre.
 *
 * Les couleurs sont des variables CSS, sauf celles du terminal : xterm peint sur
 * un canevas et ne lit pas la feuille de style. Elles sont donc relues depuis les
 * variables à chaque changement, pour qu'il n'existe qu'une seule définition.
 */
const THEMES = ["auto", "light", "dark"];
const THEME_GLYPH = { auto: "◐", light: "☀", dark: "☾" };
const THEME_LABEL = { auto: "Thème : système", light: "Thème : clair", dark: "Thème : sombre" };
let theme = localStorage.getItem("claude-ide.theme") ?? "auto";

function applyTheme() {
  if (theme === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = theme;

  const button = document.querySelector("#toggle-theme");
  if (button) {
    button.textContent = THEME_GLYPH[theme];
    button.title = THEME_LABEL[theme];
  }
  for (const entry of terminals.values()) entry.term.options.theme = terminalTheme();
}

/** Noms xterm des seize couleurs ANSI, dans l'ordre de `--ansi-0` à `--ansi-15`. */
const ANSI_NAMES = [
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow",
  "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
];

function terminalTheme() {
  const styles = getComputedStyle(document.documentElement);
  const read = (name) => styles.getPropertyValue(name).trim();
  const theme = { background: read("--term-bg"), foreground: read("--term-fg"), cursor: read("--accent") };
  ANSI_NAMES.forEach((name, index) => {
    theme[name] = read(`--ansi-${index}`);
  });
  return theme;
}

// ─── État ───────────────────────────────────────────────────────────────────

/** @type {{root: string, name: string, browsePath: string, leftMode: string, sessionMode: string, selectedSession: object|null}[]} */
let projects = [];
let activeRoot = null;

/** @type {Map<string, {info: object, term: any, fit: any, host: HTMLElement, tab: HTMLElement, owner: string}>} */
const terminals = new Map();
let activeTerminalId = null;
const attention = new Map();

let sessions = [];
/**
 * La session regardée ne dépend pas du projet ouvert : elle vient de History,
 * qui est global. La choisir ne doit donc pas déplacer le projet courant.
 */
let selectedSession = null;
let globalTab = "history";
const notifications = [];
let socket = null;

const project = () => projects.find((p) => p.root === activeRoot);

// ─── API ────────────────────────────────────────────────────────────────────

async function api(path, params = {}, options = {}) {
  const url = new URL(path, location.origin);
  url.searchParams.set("token", TOKEN);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  }
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

/** Appel d'une route qui écrit. `send` est réservé au WebSocket. */
const postJson = (path, body) => api(path, {}, { method: "POST", body: JSON.stringify(body) });

// ─── Fabriques ──────────────────────────────────────────────────────────────

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function badge(label, tone) {
  return node("span", `badge ${tone ?? ""}`, label);
}

function row(name, sub, badges = []) {
  const item = node("li");
  const line = node("span", "name");
  for (const entry of badges) line.append(badge(entry.label, entry.tone));
  line.append(node("span", null, name));
  item.append(line);
  if (sub) item.append(node("span", "sub", sub));
  return item;
}

function list(items) {
  const ul = node("ul", "rows");
  for (const item of items) ul.append(item);
  return ul;
}

const empty = (text) => node("p", "empty", text);

function centerEmpty(glyph, text) {
  const box = node("div", "center-empty");
  box.append(node("div", "glyph", glyph), node("div", null, text));
  return box;
}

function section(label) {
  return node("div", "section", label);
}

function actions(...children) {
  const box = node("div", "actions");
  box.append(...children);
  return box;
}

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

/** Bouton d'action : désactivé le temps de l'aller-retour, erreur rendue à côté. */
function onAction(button, run) {
  button.type = "button";
  button.addEventListener("click", async () => {
    const label = button.textContent;
    button.disabled = true;
    button.textContent = "…";
    button.parentElement?.querySelector(".form-error")?.remove();
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
 * Suppression en deux temps. Une confirmation modale bloquerait la page et
 * n'apporterait rien : un second clic écarte le geste involontaire.
 */
function dangerButton(label, run) {
  const button = node("button", "danger", label);
  button.type = "button";
  let armed = false;
  button.addEventListener("click", async () => {
    if (!armed) {
      armed = true;
      button.textContent = "confirmer ?";
      setTimeout(() => {
        if (armed) {
          armed = false;
          button.textContent = label;
        }
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

async function fill(host, load) {
  host.replaceChildren(empty("chargement…"));
  try {
    host.replaceChildren(await load());
  } catch (error) {
    host.replaceChildren(empty(error.message));
  }
}

// ─── Projets ────────────────────────────────────────────────────────────────

const shortName = (path) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;

function saveProjects() {
  localStorage.setItem(
    "claude-ide.projects",
    JSON.stringify({ roots: projects.map((p) => p.root), active: activeRoot }),
  );
}

function addProject(root, activate = true) {
  const trimmed = root.trim().replace(/[\\/]+$/, "");
  if (!trimmed) return;
  if (!projects.some((p) => p.root === trimmed)) {
    projects.push({
      root: trimmed,
      name: shortName(trimmed),
      browsePath: "",
      leftMode: "links",
      sessionMode: "files",
    });
  }
  if (activate) activeRoot = trimmed;
  saveProjects();
  renderProjectTabs();
  if (activate) void refreshProjectViews();
}

function closeProject(root) {
  // Les terminaux du projet partent avec lui : sans onglet, ils seraient
  // inatteignables.
  for (const [id, entry] of terminals) {
    if (entry.owner === root) {
      send({ t: "close", id });
      disposeTerminal(id);
    }
  }
  projects = projects.filter((p) => p.root !== root);
  if (activeRoot === root) activeRoot = projects[0]?.root ?? null;
  saveProjects();
  renderProjectTabs();
  void refreshProjectViews();
}

function renderProjectTabs() {
  el.projectTabs.replaceChildren(
    ...projects.map((p) => {
      const tab = node("div", `project-tab ${p.root === activeRoot ? "active" : ""}`);
      tab.title = p.root;
      const close = node("span", "close", "×");
      close.addEventListener("click", (event) => {
        event.stopPropagation();
        closeProject(p.root);
      });
      tab.append(node("span", "glyph", "▣"), node("span", "label", p.name), close);
      tab.addEventListener("click", () => {
        activeRoot = p.root;
        saveProjects();
        renderProjectTabs();
        void refreshProjectViews();
      });
      return tab;
    }),
  );
}

function promptProject() {
  const host = node("div");
  const chemin = input("C:\\Projets\\mon-projet");
  const ouvrir = node("button", "primary", "Ouvrir");
  onAction(ouvrir, async () => {
    addProject(chemin.value);
  });
  chemin.addEventListener("keydown", (event) => {
    if (event.key === "Enter") addProject(chemin.value);
  });
  host.append(section("Ouvrir un projet"), form(labeled("dossier", chemin), actions(ouvrir)));
  el.leftPanel.replaceChildren(host);
  chemin.focus();
}

async function refreshProjectViews() {
  renderTerminalTabs();
  renderWelcome();
  await Promise.all([renderFiles(), renderLeftBlock()]);
  renderSessionBlock();
}

// ─── Colonne gauche : fichiers ──────────────────────────────────────────────

const FILE_GLYPH = { dir: "▸", file: "·" };

/** Dossier parent d'un chemin relatif. La racine est sa propre limite. */
function parentOf(relativePath) {
  const segments = relativePath.split(/[\\/]/).filter(Boolean);
  segments.pop();
  return segments.join("\\");
}

async function renderFiles() {
  const current = project();
  if (!current) {
    el.crumbs.replaceChildren();
    el.files.replaceChildren();
    return;
  }

  let listing;
  try {
    listing = await api("/api/files", { root: current.root, path: current.browsePath });
  } catch (error) {
    el.crumbs.replaceChildren();
    el.files.replaceChildren(node("li", "empty", error.message));
    return;
  }

  const up = node("button", "up", "↑");
  up.type = "button";
  up.title = "Dossier parent";
  up.disabled = !listing.relativePath;
  up.addEventListener("click", () => {
    current.browsePath = parentOf(current.browsePath);
    void renderFiles();
  });

  el.crumbs.replaceChildren(
    up,
    ...listing.breadcrumb.flatMap((segment, index) => {
      const button = node("button", index === listing.breadcrumb.length - 1 ? "current" : "", segment.name);
      button.type = "button";
      button.addEventListener("click", () => {
        current.browsePath = segment.relativePath;
        void renderFiles();
      });
      return index === 0 ? [button] : [node("span", "sep", "›"), button];
    }),
  );

  const items = [];
  if (listing.relativePath) {
    const up = node("li", "up");
    up.append(node("span", "glyph", "↑"), node("span", "name", ".."));
    up.addEventListener("click", () => {
      current.browsePath = parentOf(current.browsePath);
      void renderFiles();
    });
    items.push(up);
  }

  for (const entry of listing.entries) {
    const item = node("li");
    item.title = entry.path;
    item.append(
      node("span", `glyph ${entry.directory ? "dir" : ""}`, entry.directory ? FILE_GLYPH.dir : FILE_GLYPH.file),
      node("span", "name", entry.name),
    );
    item.addEventListener("click", () => {
      if (entry.directory) {
        current.browsePath = entry.relativePath;
        void renderFiles();
        return;
      }
      // Un fichier n'ouvre rien : son chemin s'écrit dans le terminal actif,
      // ce qui est le geste utile ici. Sans terminal, il n'y a rien à faire.
      insertPath(entry.path);
    });
    items.push(item);
  }
  el.files.replaceChildren(...items);
}

function insertPath(path) {
  if (!activeTerminalId) return;
  const quoted = path.includes(" ") ? `"${path}"` : path;
  send({ t: "input", id: activeTerminalId, data: `${quoted} ` });
}

// ─── Colonne gauche : bloc à modes ──────────────────────────────────────────

const LEFT_MODES = [
  {
    id: "links",
    glyph: "🔗",
    title: "Dossiers liés",
    about:
      "Les autres projets dont celui-ci dépend. Leurs chemins sont écrits dans .claude/settings.local.json et transmis à Claude au lancement.",
    load: loadLinks,
  },
  {
    id: "scripts",
    glyph: "📦",
    title: "Scripts",
    about: "Scripts du package.json, espaces de travail compris. Le gestionnaire vient du lockfile.",
    load: loadScripts,
  },
  {
    id: "skills",
    glyph: "✦",
    title: "Skills du projet",
    about: "Un skill est un .claude/skills/<nom>/SKILL.md. Claude le charge seul quand la description correspond, ou par /nom.",
    load: loadProjectSkills,
  },
  {
    id: "mcp",
    glyph: "⛓",
    title: "MCP du projet",
    about: "Serveurs déclarés dans .mcp.json, à la racine du dépôt, partagés par l'équipe.",
    load: loadProjectMcp,
  },
  {
    id: "worktrees",
    glyph: "⑂",
    title: "Worktrees",
    about: "Les worktrees git du dépôt, leur état et les sessions qui y vivent.",
    load: loadWorktrees,
  },
];

/**
 * Barre de modes d'un bloc : les icônes à gauche, puis `ⓘ` qui explique le mode
 * courant et `˅` qui replie le bloc. Le même motif sert à gauche et sous le
 * terminal, comme dans l'original.
 */
function renderModeBar(bar, block, modes, currentId, onPick, state) {
  const buttons = modes.map((mode) => {
    const button = node("button", `mode ${currentId === mode.id ? "active" : ""}`, mode.glyph);
    button.type = "button";
    button.title = mode.title;
    button.addEventListener("click", () => onPick(mode.id));
    return button;
  });

  const info = node("button", `mode ${state.about ? "active" : ""}`, "ⓘ");
  info.type = "button";
  info.title = "À quoi sert ce mode";
  info.addEventListener("click", () => {
    state.about = !state.about;
    onPick(currentId);
  });

  const collapse = node("button", "mode", state.collapsed ? "˄" : "˅");
  collapse.type = "button";
  collapse.title = state.collapsed ? "Déplier" : "Replier";
  collapse.addEventListener("click", () => {
    state.collapsed = !state.collapsed;
    onPick(currentId);
  });

  block.classList.toggle("collapsed", state.collapsed);
  bar.replaceChildren(...buttons, node("span", "mode-spacer"), info, collapse);
}

const leftBar = { about: false, collapsed: false };
const sessionBar = { about: false, collapsed: false };

function renderLeftBlock() {
  const current = project();
  const block = el.leftModes.closest(".block");
  renderModeBar(el.leftModes, block, LEFT_MODES, current?.leftMode, (id) => {
    if (current) current.leftMode = id;
    void renderLeftBlock();
  }, leftBar);

  if (!current) {
    el.leftPanel.replaceChildren(empty("Aucun projet ouvert."));
    return;
  }
  const mode = LEFT_MODES.find((entry) => entry.id === current.leftMode) ?? LEFT_MODES[0];
  return fill(el.leftPanel, async () => {
    const host = node("div");
    if (leftBar.about) host.append(node("p", "about", mode.about));
    host.append(await mode.load(current.root));
    return host;
  });
}

/**
 * Bouton qui révèle un formulaire à la demande.
 *
 * Un formulaire déplié en permanence mange la place d'un bloc dont la liste est
 * le sujet ; l'original le garde derrière un bouton, et c'est le bon compromis.
 */
function disclosure(label, buildForm) {
  const host = node("div");
  const open = node("button", null, label);
  open.type = "button";
  open.addEventListener("click", () => {
    if (host.querySelector(".form")) {
      host.querySelector(".form").remove();
      open.textContent = label;
      return;
    }
    open.textContent = "Annuler";
    host.append(buildForm());
  });
  host.append(actions(open));
  return host;
}

async function loadLinks(root) {
  const { links } = await api("/api/links", { root });
  const container = node("div");

  const save = async (next) => {
    await postJson("/api/links/save", { root, links: next });
    await renderLeftBlock();
  };

  container.append(
    links.length
      ? list(
          links.map((link) => {
            const item = row(link.path, link.role, link.readOnly ? [{ label: "lecture seule", tone: "warn" }] : []);
            const bascule = node("button", null, link.readOnly ? "rendre modifiable" : "lecture seule");
            onAction(bascule, () =>
              save(links.map((l) => (l.path === link.path ? { ...l, readOnly: !l.readOnly } : l))),
            );
            item.append(actions(bascule, dangerButton("délier", () => save(links.filter((l) => l.path !== link.path)))));
            return item;
          }),
        )
      : centerEmpty("🔗", "Les autres dépôts dont celui-ci dépend."),
  );

  const chemin = input("C:\\Projets\\autre-depot");
  const role = input("son rôle : api, design system…");
  const lecture = select([["non", "Claude peut y écrire"], ["oui", "lecture seule"]], "non");
  const ajouter = node("button", null, "Lier ce dossier");
  onAction(ajouter, () =>
    save([
      ...links.filter((l) => l.path !== chemin.value.trim()),
      { path: chemin.value.trim(), role: role.value, readOnly: lecture.value === "oui" },
    ]),
  );
  container.append(
    disclosure("+ Lier un dossier", () =>
      form(labeled("chemin", chemin), labeled("rôle", role), labeled("accès", lecture), actions(ajouter)),
    ),
  );
  return container;
}

async function loadScripts(root) {
  const result = await api("/api/scripts", { root });
  const container = node("div");
  container.append(
    empty(`${result.manager}${result.managerDetected ? "" : " (défaut, aucun lockfile)"}`),
  );

  for (const source of result.sources) {
    if (!source.scripts.length) continue;
    container.append(section(source.packageName ?? source.relativePath ?? "racine"));
    container.append(
      list(
        source.scripts.map((script) => {
          const item = row(script.name, script.command);
          const lancer = node("button", null, "lancer");
          onAction(lancer, async () => {
            const command =
              result.manager === "npm" ? `npm run ${script.name}` : `${result.manager} run ${script.name}`;
            openTerminal("shell", command, source.directory);
          });
          item.append(actions(lancer));
          return item;
        }),
      ),
    );
  }
  if (!result.sources.some((source) => source.scripts.length)) {
    container.append(centerEmpty("📦", "Aucun script dans ce projet."));
  }
  return container;
}

async function loadProjectSkills(root) {
  const { skills } = await api("/api/skills", { root });
  const own = skills.filter((skill) => skill.scope === "project");
  const container = node("div");
  container.append(
    own.length
      ? list(own.map((skill) => skillRow(skill, root, renderLeftBlock)))
      : centerEmpty("✦", "Les skills vivent dans .claude/skills/<nom>/SKILL.md."),
  );
  const nouveau = node("button", null, "Nouveau skill de projet");
  onAction(nouveau, async () => {
    el.leftPanel.replaceChildren(
      skillForm({ scope: "project", directory: "", body: "" }, root, renderLeftBlock),
    );
  });
  container.append(actions(nouveau));
  return container;
}

async function loadProjectMcp(root) {
  const { servers } = await api("/api/mcp", { root });
  const own = servers.filter((server) => server.scope === "project");
  const container = node("div");
  container.append(
    own.length
      ? list(own.map((server) => mcpRow(server, root, renderLeftBlock)))
      : centerEmpty("⛓", "Serveurs déclarés dans .mcp.json, partagés par l'équipe."),
  );

  const nom = input("nom du serveur");
  const cible = input("https://… ou une commande");
  const ajouter = node("button", null, "Ajouter");
  onAction(ajouter, async () => {
    const valeur = cible.value.trim();
    const config = valeur.startsWith("http")
      ? { type: "http", url: valeur }
      : { command: valeur.split(/\s+/)[0], args: valeur.split(/\s+/).slice(1) };
    await postJson("/api/mcp/save", { root, name: nom.value, config });
    await renderLeftBlock();
  });
  container.append(
    disclosure("+ Ajouter un serveur", () => form(labeled("nom", nom), labeled("cible", cible), actions(ajouter))),
  );
  return container;
}

async function loadWorktrees(root) {
  const { worktrees } = await api("/api/worktrees", { root });
  if (!worktrees.length) return centerEmpty("⑂", "Ce dossier n'est pas un dépôt git.");

  return list(
    worktrees.map((worktree) => {
      const badges = [];
      if (worktree.main) badges.push({ label: "principal" });
      if (worktree.detached) badges.push({ label: "détaché", tone: "warn" });
      if (worktree.locked !== undefined) badges.push({ label: "verrouillé", tone: "warn" });
      if (worktree.dirty > 0) badges.push({ label: `${worktree.dirty} non commité(s)`, tone: "warn" });

      const suite = [];
      if (worktree.ahead || worktree.behind) suite.push(`↑${worktree.ahead ?? 0} ↓${worktree.behind ?? 0}`);
      if (worktree.sessions.length) suite.push(`${worktree.sessions.length} session(s)`);

      const item = row(worktree.branch ?? worktree.head?.slice(0, 8) ?? "?", suite.join("  ·  "), badges);
      const ouvrir = node("button", null, "terminal ici");
      onAction(ouvrir, async () => openTerminal("shell", undefined, worktree.path));

      const boutons = [ouvrir];
      if (!worktree.main) {
        boutons.push(
          dangerButton("retirer", async () => {
            await postJson("/api/worktrees/remove", { root, path: worktree.path });
            await renderLeftBlock();
          }),
        );
      }
      item.append(actions(...boutons));
      return item;
    }),
  );
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
    setConnection("off", "déconnecté…");
    setTimeout(connect, 1500);
  });
  socket.addEventListener("message", (event) => onServerMessage(JSON.parse(event.data)));
}

function send(message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

/** Projet auquel rattacher le prochain terminal ouvert. */
let pendingOwner = null;

function onServerMessage(message) {
  switch (message.t) {
    case "opened":
      createTerminalView(message.terminal, pendingOwner ?? activeRoot);
      pendingOwner = null;
      break;
    case "data":
      terminals.get(message.id)?.term.write(message.data);
      break;
    case "state": {
      const entry = terminals.get(message.terminal.id);
      if (entry) {
        entry.info = message.terminal;
        renderTab(entry);
        if (message.terminal.id === activeTerminalId) renderStatus(message.terminal);
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

function openTerminal(kind, initialCommand, cwd) {
  const current = project();
  if (!current) return;
  pendingOwner = current.root;
  send({
    t: "open",
    projectRoot: cwd ?? current.root,
    kind,
    cols: 100,
    rows: 30,
    ...(initialCommand ? { initialCommand } : {}),
  });
}

function createTerminalView(info, owner) {
  const host = node("div", "term");
  el.terminals.append(host);

  const term = new window.Terminal({
    fontFamily: 'Consolas, "Cascadia Mono", monospace',
    fontSize: 13,
    cursorBlink: true,
    theme: terminalTheme(),
  });
  const fit = new window.FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(host);
  term.onData((data) => send({ t: "input", id: info.id, data }));
  attachFileDrop(host, info.id);

  const tab = node("div", "tab");
  const entry = { info, term, fit, host, tab, owner: owner ?? activeRoot };
  terminals.set(info.id, entry);

  tab.addEventListener("click", (event) => {
    if (event.target.dataset.action === "close") {
      send({ t: "close", id: info.id });
      disposeTerminal(info.id);
      return;
    }
    activate(info.id);
  });

  renderTerminalTabs();
  activate(info.id);
}

/**
 * Écrit le chemin d'un fichier déposé dans le terminal.
 *
 * Le chemin d'origine n'est connu que sous Electron : un navigateur livre le
 * contenu d'un fichier déposé, jamais son emplacement. Ailleurs, le dépôt est
 * laissé au navigateur plutôt que de coller un nom qui ne désigne rien.
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
    if (chemins.length > 0) send({ t: "input", id: terminalId, data: `${chemins.join(" ")} ` });
  });
}

function disposeTerminal(id) {
  const entry = terminals.get(id);
  if (!entry) return;
  entry.term.dispose();
  entry.host.remove();
  terminals.delete(id);
  attention.delete(id);
  if (activeTerminalId === id) activeTerminalId = null;
  renderTerminalTabs();
  const next = [...terminals.values()].find((candidate) => candidate.owner === activeRoot);
  if (next) activate(next.info.id);
  else {
    renderStatus(null);
    renderWelcome();
  }
}

/** Les onglets ne montrent que les terminaux du projet courant. */
function renderTerminalTabs() {
  el.tabs.replaceChildren(
    ...[...terminals.values()]
      .filter((entry) => entry.owner === activeRoot)
      .map((entry) => {
        renderTab(entry);
        return entry.tab;
      }),
  );
  for (const entry of terminals.values()) {
    entry.host.classList.toggle("active", entry.info.id === activeTerminalId && entry.owner === activeRoot);
  }
  const active = terminals.get(activeTerminalId);
  renderStatus(active && active.owner === activeRoot ? active.info : null);
  renderWelcome();
}

function renderTab({ info, tab }) {
  tab.className = `tab ${info.id === activeTerminalId ? "active" : ""}`;
  const close = node("span", "close", "×");
  close.dataset.action = "close";
  const waiting = attention.get(info.id);
  const children = [node("span", `dot ${info.state}`), node("span", null, info.title)];
  if (waiting) children.push(node("span", `bell ${waiting}`, "●"));
  children.push(close);
  tab.replaceChildren(...children);
}

function activate(id) {
  const entry = terminals.get(id);
  if (!entry) return;
  // Activer un terminal d'un autre projet suit ce projet : l'onglet et la
  // colonne de gauche doivent décrire ce qu'on regarde.
  if (entry.owner !== activeRoot) {
    activeRoot = entry.owner;
    renderProjectTabs();
    void refreshProjectViews();
  }
  activeTerminalId = id;
  attention.delete(id);
  renderBadge();
  renderTerminalTabs();
  requestAnimationFrame(() => {
    entry.fit.fit();
    send({ t: "resize", id, cols: entry.term.cols, rows: entry.term.rows });
    entry.term.focus();
  });
  renderStatus(entry.info);
}

function renderStatus(info) {
  if (!info) {
    el.status.replaceChildren();
    return;
  }
  const bits = [info.cwd, info.kind, info.state];
  if (info.lastExitCode !== undefined) bits.push(`sortie ${info.lastExitCode}`);
  el.status.textContent = bits.join("   ·   ");
}

function renderWelcome() {
  const current = project();
  const own = [...terminals.values()].filter((entry) => entry.owner === activeRoot);
  el.welcome.classList.toggle("hidden", own.length > 0);
  el.welcomeTitle.textContent = current ? "Aucun terminal" : "Aucun projet ouvert";
  el.welcomePath.textContent = current?.root ?? "Ouvre un projet pour commencer.";
  el.welcomeClaude.disabled = !current;
  el.welcomeShell.disabled = !current;
}

// ─── Bloc session ───────────────────────────────────────────────────────────

const SESSION_MODES = [
  {
    id: "plan",
    glyph: "📋",
    title: "Plan",
    about: "Le plan que Claude soumet en sortant du mode plan, avec sa progression si le plan porte des cases.",
    load: loadPlan,
  },
  {
    id: "activity",
    glyph: "📈",
    title: "Activité",
    about: "Le déroulé de la session : prompts, réponses et appels d'outils.",
    load: loadActivity,
  },
  {
    id: "files",
    glyph: "📄",
    title: "Fichiers",
    about:
      "Ce que la session a changé, avec le diff exact. L'état « avant » vient des sauvegardes de Claude Code, pas de git.",
    load: loadSessionFiles,
  },
];

function renderSessionBlock() {
  const current = project();
  const block = el.sessionModes.closest(".block");
  renderModeBar(el.sessionModes, block, SESSION_MODES, current?.sessionMode, (id) => {
    if (current) current.sessionMode = id;
    void renderSessionBlock();
  }, sessionBar);

  const selected = selectedSession;
  if (!selected) {
    el.sessionPanel.replaceChildren(centerEmpty("📄", "Choisis une session dans History, à droite."));
    return;
  }
  const mode = SESSION_MODES.find((entry) => entry.id === current.sessionMode) ?? SESSION_MODES[2];
  return fill(el.sessionPanel, async () => {
    const host = node("div");
    host.append(node("p", "about session-title", selected.title ?? selected.sessionId.slice(0, 8)));
    if (sessionBar.about) host.append(node("p", "about", mode.about));
    host.append(await mode.load(selected));
    return host;
  });
}

async function loadSessionFiles(selected) {
  const { diffs } = await api("/api/session/files", { id: selected.sessionId });
  if (!diffs?.length) return centerEmpty("📄", "Aucun fichier touché.");

  const container = node("div");
  for (const diff of diffs) {
    const badges = [];
    if (diff.created) badges.push({ label: "créé", tone: "ok" });
    if (diff.deleted) badges.push({ label: "supprimé", tone: "warn" });
    if (diff.binary) badges.push({ label: "binaire" });
    if (diff.beforeMissing) badges.push({ label: "sauvegarde absente", tone: "warn" });

    const item = row(diff.trackingPath, `+${diff.linesAdded}  −${diff.linesRemoved}`, badges);
    if (diff.unified) {
      const pre = node("pre", "code diff");
      for (const line of diff.unified.split("\n")) {
        const cls = line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : line.startsWith("@@") ? "hunk" : null;
        pre.append(node("span", cls, `${line}\n`));
      }
      item.append(pre);
    }
    container.append(list([item]));
  }
  return container;
}

const ACTIVITY_LABEL = { prompt: "moi", command: "commande", answer: "claude", tool: "outil", note: "note" };

async function loadActivity(selected) {
  const feed = await api("/api/session/activity", { id: selected.sessionId, limit: 300 });
  if (!feed.entries?.length) return centerEmpty("📈", "Aucune activité.");

  const container = node("div");
  if (feed.total > feed.entries.length) {
    container.append(empty(`${feed.entries.length} dernières entrées sur ${feed.total}.`));
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

async function loadPlan(selected) {
  const { plan, mode, planModeEntries } = await api("/api/session/plan", { id: selected.sessionId });
  if (!plan) {
    return centerEmpty(
      "📋",
      planModeEntries > 0
        ? "Passée en mode plan, mais aucun plan soumis."
        : `Jamais passée en mode plan. Mode courant : ${mode ?? "inconnu"}.`,
    );
  }
  const container = node("div");
  if (plan.progress) container.append(empty(`${plan.progress.done} sur ${plan.progress.total} étapes cochées`));
  container.append(node("pre", "code", plan.text));
  return container;
}

// ─── Panneau droit : le global ──────────────────────────────────────────────

const GLOBAL_TABS = [
  { id: "processes", glyph: "⚙", label: "Process", load: loadProcesses },
  { id: "history", glyph: "🕐", label: "History", load: loadHistory },
  { id: "skills", glyph: "✦", label: "Skills", load: loadUserSkills },
  { id: "mcp", glyph: "⛓", label: "MCP", load: loadUserMcp },
  { id: "settings", glyph: "⚙", label: "Réglages", load: loadSettings },
  { id: "notifications", glyph: "🔔", label: "Alertes", load: loadNotifications },
];

function renderGlobalTabs() {
  el.globalTabs.replaceChildren(
    ...GLOBAL_TABS.map((tab) => {
      const button = node("button", `global-tab ${tab.id === globalTab ? "active" : ""}`);
      button.type = "button";
      button.append(node("span", "glyph", tab.glyph), node("span", null, tab.label));
      button.addEventListener("click", () => showGlobal(tab.id));
      return button;
    }),
  );
}

function showGlobal(id) {
  globalTab = id;
  renderGlobalTabs();
  const tab = GLOBAL_TABS.find((entry) => entry.id === id);
  el.globalFilter.style.display = id === "history" || id === "skills" ? "" : "none";
  return fill(el.globalPanel, () => tab.load());
}

async function loadHistory() {
  sessions = (await api("/api/sessions")).sessions;
  return renderHistory();
}

function renderHistory() {
  const needle = el.globalFilter.value.trim().toLowerCase();
  const shown = sessions.filter((session) =>
    needle
      ? `${session.title ?? ""} ${session.effectiveCwd ?? ""} ${session.gitBranch ?? ""}`.toLowerCase().includes(needle)
      : true,
  );
  if (!shown.length) return centerEmpty("🕐", "Aucune session.");

  const ul = node("ul", "rows sessions");
  for (const session of shown.slice(0, 200)) {
    const when = session.lastActivityAt ? new Date(session.lastActivityAt).toLocaleString("fr-FR") : "";
    const folder = shortName(session.effectiveCwd ?? "");
    const item = row(
      session.title ?? session.lastPrompt ?? session.sessionId.slice(0, 8),
      [when, folder, session.gitBranch, `${session.fileCount} fichiers`].filter(Boolean).join("  ·  "),
      session.prLinks?.length ? [{ label: "MR", tone: "accent" }] : [],
    );
    item.dataset.id = session.sessionId;
    const reprendre = node("button", null, "reprendre");
    onAction(reprendre, async () => {
      // `--resume` relance la session là où elle vivait, ce qui ouvre le projet
      // au passage : c'est une action explicite, contrairement à la sélection.
      if (session.effectiveCwd) addProject(session.effectiveCwd);
      openTerminal("claude", `claude --resume ${session.sessionId}`, session.effectiveCwd);
    });
    item.append(actions(reprendre));
    if (selectedSession?.sessionId === session.sessionId) item.classList.add("selected");
    item.addEventListener("click", () => selectSession(session));
    ul.append(item);
  }
  return ul;
}

function selectSession(session) {
  selectedSession = session;
  for (const item of el.globalPanel.querySelectorAll("li[data-id]")) {
    item.classList.toggle("selected", item.dataset.id === session.sessionId);
  }
  renderSessionBlock();
}

async function loadUserSkills() {
  const root = project()?.root ?? "";
  const { skills, commands } = await api("/api/skills", { root });
  const needle = el.globalFilter.value.trim().toLowerCase();
  const match = (text) => (needle ? (text ?? "").toLowerCase().includes(needle) : true);

  const personal = skills.filter((skill) => skill.scope === "user" && match(`${skill.name} ${skill.description}`));
  const container = node("div");

  container.append(section("Personnels"));
  container.append(
    personal.length
      ? list(personal.map((skill) => skillRow(skill, root, () => showGlobal("skills"))))
      : empty("Aucun skill personnel."),
  );

  const nouveau = node("button", null, "Nouveau skill");
  onAction(nouveau, async () => {
    el.globalPanel.replaceChildren(
      skillForm({ scope: "user", directory: "", body: "" }, root, () => showGlobal("skills")),
    );
  });
  container.append(actions(nouveau));

  const shown = commands.filter((command) => match(`${command.name} ${command.description}`));
  container.append(section(`Commandes (${shown.length})`));
  container.append(
    shown.length
      ? list(shown.map((command) => row(`/${command.name}`, command.description)))
      : empty("Aucune commande."),
  );
  return container;
}

function skillRow(skill, root, after) {
  const item = row(skill.name, skill.description, [
    { label: skill.scope === "project" ? "projet" : "perso" },
    ...(skill.invocation === "auto-and-slash"
      ? [{ label: "auto + /" }]
      : [{ label: skill.invocation === "manual-only" ? "/ seulement" : "auto seulement", tone: "warn" }]),
  ]);

  const editer = node("button", null, "éditer");
  onAction(editer, async () => {
    const { raw } = await api("/api/skill", {
      scope: skill.scope,
      directory: skill.directory,
      ...(skill.scope === "project" ? { root } : {}),
    });
    const host = skill.scope === "project" ? el.leftPanel : el.globalPanel;
    host.replaceChildren(skillForm({ ...skill, body: stripFrontmatter(raw) }, root, after));
  });

  item.append(
    actions(
      editer,
      dangerButton("supprimer", async () => {
        await postJson("/api/skills/remove", {
          scope: skill.scope,
          directory: skill.directory,
          ...(skill.scope === "project" ? { root } : {}),
        });
        await after();
      }),
    ),
  );
  return item;
}

function stripFrontmatter(raw) {
  if (!raw.startsWith("---")) return raw;
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return raw;
  return raw.slice(raw.indexOf("\n", end + 1) + 1).replace(/^\n+/, "");
}

function skillForm(skill, root, after) {
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
  const corps = textarea(skill.body ?? "", 10);

  const enregistrer = node("button", "primary", "Enregistrer");
  onAction(enregistrer, async () => {
    await postJson("/api/skills/save", {
      scope: skill.scope,
      directory: directory.value,
      name: nom.value,
      description: description.value,
      invocation: invocation.value,
      body: corps.value,
      ...(skill.scope === "project" ? { root } : {}),
    });
    await after();
  });
  const annuler = node("button", null, "Annuler");
  onAction(annuler, async () => after());

  return form(
    labeled("dossier", directory),
    labeled("nom", nom),
    labeled("description", description),
    labeled("invocation", invocation),
    labeled("contenu", corps),
    actions(enregistrer, annuler),
  );
}

async function loadUserMcp() {
  const root = project()?.root ?? "";
  const { servers } = await api("/api/mcp", { root });
  const container = node("div");

  for (const [scope, label] of [["user", "Personnels"], ["local", "Locaux à ce projet"]]) {
    const own = servers.filter((server) => server.scope === scope);
    container.append(section(label));
    container.append(own.length ? list(own.map((server) => mcpRow(server, root))) : empty("Aucun."));
  }
  // Ces deux portées vivent dans `~/.claude.json`, qui porte aussi l'historique
  // de chaque projet : elles se modifient par la CLI, pas d'ici.
  container.append(empty("Ces portées se modifient par `claude mcp add|remove`."));
  return container;
}

function mcpRow(server, root, after) {
  const target = server.url ?? [server.command, ...(server.args ?? [])].join(" ");
  const keys = [...Object.keys(server.headers ?? {}), ...Object.keys(server.env ?? {})];
  const item = row(
    server.name,
    [target, keys.length ? `secrets masqués : ${keys.join(", ")}` : ""].filter(Boolean).join("  ·  "),
    [{ label: server.scope }, { label: server.transport }],
  );
  if (server.scope === "project" && after) {
    item.append(
      actions(
        dangerButton("retirer", async () => {
          await postJson("/api/mcp/remove", { root, name: server.name });
          await after();
        }),
      ),
    );
  }
  return item;
}

async function loadSettings() {
  const document_ = await api("/api/settings");
  const container = node("div");
  container.append(empty(document_.path));
  const texte = textarea(document_.raw, 20);
  const enregistrer = node("button", "primary", "Enregistrer");
  onAction(enregistrer, async () => {
    await postJson("/api/settings/replace", { raw: texte.value });
    await showGlobal("settings");
  });
  const recharger = node("button", null, "Recharger");
  onAction(recharger, async () => showGlobal("settings"));
  container.append(
    empty("Une sauvegarde de l'original est posée avant la première modification."),
    form(texte, actions(enregistrer, recharger)),
  );
  return container;
}

async function loadProcesses() {
  const { tree } = await api("/api/processes");
  if (!tree.length) return centerEmpty("⚙", "Aucun processus Claude en cours.");

  const render = (nodes, isRoot) => {
    const ul = node("ul", `tree ${isRoot ? "root" : ""}`);
    for (const item of nodes) {
      const li = node("li");
      const tone = item.link.kind === "owned" ? "ok" : item.link.kind === "inferred" ? "warn" : "";
      const label =
        item.link.kind === "owned" ? "ce terminal" : item.link.kind === "inferred" ? "lancé ailleurs" : "enfant";
      const line = node("span", "name");
      line.append(badge(label, tone), node("span", null, `${item.name} · ${item.pid}`));

      if (item.link.kind !== "orphan") {
        const stop = node("button", "danger", "arrêter");
        onAction(stop, async () => {
          await api("/api/processes/stop", { pid: item.pid }, { method: "POST" });
          await showGlobal("processes");
        });
        line.append(stop);
      }
      li.append(line, node("span", "sub", `${item.memoryMB} Mo`));
      if (item.children.length) li.append(render(item.children, false));
      ul.append(li);
    }
    return ul;
  };
  return render(tree, true);
}

// ─── Notifications ──────────────────────────────────────────────────────────

const NOTIFICATION_LABEL = {
  permission: "permission demandée",
  idle: "en attente d'une réponse",
  stop: "réponse terminée",
  other: "événement",
};

function renderBadge() {
  document.title = attention.size > 0 ? `(${attention.size}) claude-ide` : "claude-ide";
  desktop?.setAttention(attention.size);
}

function onNotification(notification, terminalId) {
  notifications.unshift(notification);
  if (notifications.length > 100) notifications.pop();

  if (terminalId && terminalId !== activeTerminalId) {
    attention.set(terminalId, notification.kind);
    const entry = terminals.get(terminalId);
    if (entry) renderTab(entry);
    renderBadge();
  }

  if (document.hidden && window.Notification?.permission === "granted") {
    const system = new Notification(`claude-ide — ${NOTIFICATION_LABEL[notification.kind]}`, {
      body: notification.message ?? notification.cwd ?? "",
      tag: notification.kind,
    });
    system.onclick = () => {
      window.focus();
      if (terminalId) activate(terminalId);
      system.close();
    };
  }
  if (globalTab === "notifications") void showGlobal("notifications");
}

async function loadNotifications() {
  const { status, recent } = await api("/api/notifications");
  const seen = new Set(notifications.map((item) => item.id));
  const all = [...notifications, ...recent.filter((item) => !seen.has(item.id))];

  const container = node("div");
  const state = node("p", "empty");
  state.append(
    status.installed
      ? badge("hooks installés", "ok")
      : badge(status.kinds.length > 0 ? "installation partielle" : "hooks absents", "warn"),
    node("span", null, status.installed
      ? " Claude Code signale permissions, attentes et fins de réponse."
      : " Sans eux, aucun événement ne remonte."),
  );
  container.append(state);

  const toggle = node("button", status.installed ? "" : "primary", status.installed ? "Désinstaller" : "Installer les hooks");
  toggle.title = status.settingsPath;
  onAction(toggle, async () => {
    await postJson(status.installed ? "/api/notifications/uninstall" : "/api/notifications/install", {});
    if (window.Notification && Notification.permission === "default") await Notification.requestPermission();
    await showGlobal("notifications");
  });
  container.append(actions(toggle));

  container.append(section("Reçus"));
  container.append(
    all.length
      ? list(
          all.slice(0, 60).map((item) =>
            row(
              item.message ?? NOTIFICATION_LABEL[item.kind],
              [new Date(item.receivedAt).toLocaleTimeString("fr-FR"), shortName(item.cwd ?? "")]
                .filter(Boolean)
                .join("  ·  "),
              [{ label: NOTIFICATION_LABEL[item.kind], tone: item.kind === "permission" ? "warn" : "" }],
            ),
          ),
        )
      : empty("Aucun événement reçu."),
  );
  return container;
}

// ─── Démarrage ──────────────────────────────────────────────────────────────

el.addProject.addEventListener("click", promptProject);
el.openShell.addEventListener("click", () => openTerminal("shell"));
el.openClaude.addEventListener("click", () => openTerminal("claude", "claude"));
el.welcomeShell.addEventListener("click", () => openTerminal("shell"));
el.welcomeClaude.addEventListener("click", () => openTerminal("claude", "claude"));
el.globalRefresh.addEventListener("click", () => void showGlobal(globalTab));
el.globalFilter.addEventListener("input", () => {
  if (globalTab === "history") el.globalPanel.replaceChildren(renderHistory());
  else if (globalTab === "skills") void showGlobal("skills");
});

document.querySelector("#toggle-theme").addEventListener("click", () => {
  theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  localStorage.setItem("claude-ide.theme", theme);
  applyTheme();
});

// En mode « système », suivre les changements d'apparence sans recharger.
window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
  if (theme === "auto") applyTheme();
});

const layout = document.querySelector(".layout");
el.toggleLeft.addEventListener("click", () => layout.classList.toggle("no-left"));
el.toggleRight.addEventListener("click", () => layout.classList.toggle("no-right"));

window.addEventListener("resize", () => {
  const entry = terminals.get(activeTerminalId);
  if (!entry) return;
  entry.fit.fit();
  send({ t: "resize", id: activeTerminalId, cols: entry.term.cols, rows: entry.term.rows });
});

try {
  const saved = JSON.parse(localStorage.getItem("claude-ide.projects") ?? "{}");
  for (const root of saved.roots ?? []) addProject(root, false);
  activeRoot = saved.active ?? projects[0]?.root ?? null;
} catch {
  // Rien de mémorisé, ou mémoire illisible : on démarre sans projet ouvert.
}

applyTheme();
renderProjectTabs();
renderGlobalTabs();
connect();
void refreshProjectViews();
void showGlobal("history");
