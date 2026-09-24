import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, normalize, resolve, sep } from "node:path";

import { LinkStore, SessionIndex, appDataDir, settingsFile, SearchIndex } from "@claude-ide/core";
import { WebSocketServer, type WebSocket } from "ws";

import { mutations, routes, type ApiContext } from "./api/routes.js";
import { NotificationWatcher } from "./notifications/watcher.js";
import { LiveSessions } from "./sessions/live.js";
import { calibrationOf } from "./sessions/costs.js";
import { readRawBody, saveAttachment } from "./platform/attachments.js";
import { ProcessLister } from "./platform/processes.js";
import { PtyManager } from "./pty/manager.js";
import { parseClientMessage, type ServerMessage } from "./protocol.js";

export interface ServerOptions {
  /** Racine des fichiers statiques du client. */
  webRoot: string;
  /** Fichiers servis sous `/vendor/`, par nom de fichier. */
  vendor?: Record<string, string>;
  port?: number;
  /** Jeton d'accès. Généré si absent. */
  token?: string;
  /** Fichiers que les mutations modifient. Détournables pour les tests. */
  settingsPath?: string;
  dataDir?: string;
}

export interface RunningServer {
  url: string;
  port: number;
  token: string;
  close(): Promise<void>;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

/**
 * Lit le corps d'une requête.
 *
 * La taille est bornée : ces routes écrivent dans des fichiers de configuration,
 * et rien de légitime n'y dépasse quelques dizaines de kilo-octets. Un corps
 * absent vaut un objet vide — une mutation sans paramètre reste valable.
 */
const MAX_BODY = 1 << 20;

function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((done, fail) => {
    let raw = "";
    request.on("data", (chunk: Buffer) => {
      raw += chunk.toString("utf8");
      if (raw.length > MAX_BODY) {
        fail(new Error("corps de requête trop volumineux"));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (raw.trim().length === 0) return done({});
      try {
        const value: unknown = JSON.parse(raw);
        done(value && typeof value === "object" && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {});
      } catch {
        fail(new Error("corps de requête illisible"));
      }
    });
    request.on("error", fail);
  });
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(payload);
}

/**
 * Le serveur n'écoute que sur la boucle locale, mais cela ne suffit pas : une
 * page web ouverte dans le navigateur peut joindre `127.0.0.1`, et une connexion
 * WebSocket n'est pas soumise à la politique d'origine. Sans contrôle, n'importe
 * quel site visité pourrait ouvrir un shell sur la machine.
 *
 * D'où deux verrous : un jeton tiré au démarrage, exigé sur toute requête, et un
 * refus des connexions dont l'origine n'est pas la nôtre.
 */
function isAuthorized(request: IncomingMessage, token: string, port: number): boolean {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  if (url.searchParams.get("token") === token) return true;
  return request.headers["authorization"] === `Bearer ${token}`;
}

function isAllowedOrigin(request: IncomingMessage, port: number): boolean {
  const origin = request.headers["origin"];
  // Un client hors navigateur n'envoie pas d'origine : il est jugé sur son jeton.
  if (!origin) return true;
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

async function serveFile(response: ServerResponse, target: string): Promise<boolean> {
  try {
    const info = await stat(target);
    if (!info.isFile()) return false;
    response.writeHead(200, {
      "content-type": MIME[extname(target).toLowerCase()] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    createReadStream(target).pipe(response);
    return true;
  } catch {
    return false;
  }
}

async function serveStatic(
  response: ServerResponse,
  root: string,
  requestPath: string,
): Promise<boolean> {
  const relative = normalize(decodeURIComponent(requestPath)).replace(/^([\\/])+/, "");
  const target = resolve(root, relative);
  // Un `..` dans l'URL ne doit pas sortir de la racine servie.
  if (target !== resolve(root) && !target.startsWith(resolve(root) + sep)) return false;
  return serveFile(response, target);
}

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const token = options.token ?? randomBytes(24).toString("base64url");
  const manager = new PtyManager();
  const notifications = new NotificationWatcher(options.dataDir ?? appDataDir());
  const live = new LiveSessions();
  const context: ApiContext = {
    index: new SessionIndex(),
    search: new SearchIndex(),
    processes: new ProcessLister(),
    terminals: manager,
    notifications,
    live,
    settingsPath: options.settingsPath ?? settingsFile(),
    dataDir: options.dataDir ?? appDataDir(),
  };
  await context.index.load();
  await notifications.start();

  // Les tarifs viennent des relevés de l'index, tel qu'il est à cet instant.
  live.usePricing(() => calibrationOf(context.index));
  live.start();
  // Un onglet fermé ne suit plus rien ; son transcript redevient disponible pour
  // un autre onglet du même dossier.
  manager.on("exit", (id) => live.forget(id));
  // Chaque `claude` lancé dans un onglet repart de zéro : une nouvelle session, ou
  // celle que nomme `--resume`. À sa sortie, l'onglet ne suit plus rien.
  manager.on("claude", (id, command) => {
    live.forget(id);
    const terminal = manager.get(id);
    if (command !== undefined && terminal) live.track(id, terminal.cwd, command);
  });
  // Un hook porte la session et son transcript : c'est le rattachement exact,
  // qui prime sur la recherche par date.
  notifications.on((notification) => {
    if (!notification.cwd || !notification.transcriptPath || !notification.sessionId) return;
    const terminal = manager.findByCwd(notification.cwd);
    if (terminal?.kind === "claude") live.bind(terminal.id, notification.transcriptPath, notification.sessionId);
  });

  const http: Server = createServer((request, response) => {
    void handleRequest(request, response);
  });

  const port = await listen(http, options.port ?? 0);

  async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);

    if (url.pathname.startsWith("/api/")) {
      if (!isAuthorized(request, token, port) || !isAllowedOrigin(request, port)) {
        send(response, 401, { error: "jeton invalide" });
        return;
      }
      // Une image arrive brute, hors du corps JSON des mutations : encodée en
      // base64 elle dépasserait vite leur limite, pensée pour des réglages.
      if (url.pathname === "/api/attachments") {
        if (request.method !== "POST") {
          send(response, 405, { error: "cette route exige POST" });
          return;
        }
        try {
          const bytes = await readRawBody(request);
          const path = await saveAttachment(request.headers["content-type"] ?? "", bytes, context.dataDir);
          send(response, 200, { path });
        } catch (error) {
          send(response, 400, { error: error instanceof Error ? error.message : String(error) });
        }
        return;
      }

      const mutation = mutations[url.pathname];
      if (mutation) {
        if (request.method !== "POST") {
          send(response, 405, { error: "cette route exige POST" });
          return;
        }
        try {
          const body = await readBody(request);
          send(response, 200, await mutation(url.searchParams, context, body));
        } catch (error) {
          send(response, 400, { error: error instanceof Error ? error.message : String(error) });
        }
        return;
      }

      const handler = routes[url.pathname];
      if (!handler) {
        send(response, 404, { error: `route inconnue : ${url.pathname}` });
        return;
      }
      try {
        send(response, 200, await handler(url.searchParams, context));
      } catch (error) {
        send(response, 400, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (url.pathname.startsWith("/vendor/")) {
      // Les fichiers de bibliothèque sont servis depuis `node_modules` par une
      // table explicite : aucun chemin venant de l'URL n'est résolu sur disque.
      const file = options.vendor?.[url.pathname.slice("/vendor/".length)];
      if (file && (await serveFile(response, file))) return;
      send(response, 404, { error: "ressource inconnue" });
      return;
    }

    const path = url.pathname === "/" ? "index.html" : url.pathname;
    if (await serveStatic(response, options.webRoot, path)) return;
    send(response, 404, { error: "introuvable" });
  }

  const sockets = new WebSocketServer({ noServer: true });

  http.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    if (url.pathname !== "/pty" || !isAuthorized(request, token, port) || !isAllowedOrigin(request, port)) {
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, (socketConnection) => {
      attach(socketConnection);
    });
  });

  function attach(socket: WebSocket): void {
    const post = (message: ServerMessage): void => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    };

    const unsubscribe = [
      manager.on("data", (id, data) => post({ t: "data", id, data })),
      manager.on("state", (terminal) => post({ t: "state", terminal })),
      manager.on("exit", (id, exitCode) => post({ t: "exit", id, exitCode })),
      live.on((terminalId, session) => post({ t: "live", terminalId, session })),
      notifications.on((notification) => {
        // Claude Code annonce le dossier de la session, pas l'onglet : le
        // rattachement se fait sur ce dossier, et reste absent s'il ne
        // correspond à aucun terminal ouvert.
        const terminal = notification.cwd ? manager.findByCwd(notification.cwd) : undefined;
        if (notification.kind === "resume") {
          if (terminal) post({ t: "resume", terminalId: terminal.id });
          return;
        }
        post({ t: "notification", notification, ...(terminal ? { terminalId: terminal.id } : {}) });
      }),
    ];

    const terminals = manager.list();
    post({
      t: "hello",
      terminals,
      backlogs: Object.fromEntries(terminals.map((terminal) => [terminal.id, manager.backlog(terminal.id)])),
    });
    for (const { terminalId, session } of live.current()) post({ t: "live", terminalId, session });

    socket.on("message", (raw) => {
      const message = parseClientMessage(raw.toString());
      if (!message) {
        post({ t: "error", message: "message rejeté" });
        return;
      }
      void handleMessage(message, post);
    });

    socket.on("close", () => {
      for (const off of unsubscribe) off();
    });
  }

  async function handleMessage(
    message: NonNullable<ReturnType<typeof parseClientMessage>>,
    post: (message: ServerMessage) => void,
  ): Promise<void> {
    try {
      switch (message.t) {
        case "open": {
          // Le fichier de prompt suit ce que dit le projet, y compris quand ses
          // liens ont été modifiés à la main. Son échec ne doit pas empêcher
          // d'ouvrir un terminal : sans lui, `claude` démarre sans le drapeau.
          try {
            await new LinkStore().writePrompt(message.projectRoot);
          } catch {
            // Projet en lecture seule, ou disparu depuis son ouverture.
          }

          const terminal = await manager.open({
            projectRoot: message.projectRoot,
            ...(message.kind ? { kind: message.kind } : {}),
            ...(message.cols !== undefined ? { cols: message.cols } : {}),
            ...(message.rows !== undefined ? { rows: message.rows } : {}),
            ...(message.initialCommand ? { initialCommand: message.initialCommand } : {}),
            ...(message.owner ? { owner: message.owner } : {}),
          });
          if (terminal.kind === "claude") live.track(terminal.id, terminal.cwd, message.initialCommand);
          post({ t: "opened", terminal });
          break;
        }
        case "input":
          manager.write(message.id, message.data);
          break;
        case "resize":
          manager.resize(message.id, message.cols, message.rows);
          break;
        case "close":
          manager.close(message.id);
          break;
      }
    } catch (error) {
      post({ t: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    url: `http://127.0.0.1:${port}/?token=${token}`,
    port,
    token,
    async close() {
      live.stop();
      notifications.stop();
      manager.closeAll();
      // `http.close()` attend la fin des connexions en cours : une WebSocket
      // ouverte ne se termine jamais d'elle-même, et l'arrêt resterait bloqué.
      for (const client of sockets.clients) client.terminate();
      sockets.close();
      http.closeAllConnections();
      await new Promise<void>((done) => http.close(() => done()));
    },
  };
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((done, fail) => {
    server.once("error", fail);
    // Boucle locale uniquement : rien de ce serveur n'est exposé au réseau.
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") done(address.port);
      else fail(new Error("port introuvable"));
    });
  });
}
