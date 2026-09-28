import type { ChildProcess } from "node:child_process";

import { CdpConnection } from "./cdp.js";
import { BROWSER_PORT, browserEndpoint, findBrowser, launchBrowser } from "./launch.js";

export interface BrowserPage {
  id: string;
  url: string;
  title: string;
}

export interface BrowserState {
  status: "stopped" | "starting" | "running" | "error";
  error?: string;
  port: number;
  pages: BrowserPage[];
  /** Page montrée : la dernière ouverte, ou celle qu'on a choisie depuis. */
  current?: string;
}

export interface BrowserFrame {
  /** JPEG en base64. */
  data: string;
  /** Taille de la page en pixels CSS : les clics s'y rapportent. */
  width: number;
  height: number;
}

/** Une entrée relayée à la page montrée, en pixels CSS de la page. */
export type BrowserInput =
  | { kind: "click"; x: number; y: number; button?: "left" | "middle" | "right" }
  | { kind: "move"; x: number; y: number }
  | { kind: "wheel"; x: number; y: number; deltaX: number; deltaY: number }
  | { kind: "text"; text: string }
  | { kind: "key"; key: string };

/** Touches spéciales relayées telles quelles : le reste passe comme texte tapé. */
const KEYS: Record<string, { code: string; keyCode: number; text?: string }> = {
  Enter: { code: "Enter", keyCode: 13, text: "\r" },
  Backspace: { code: "Backspace", keyCode: 8 },
  Tab: { code: "Tab", keyCode: 9 },
  Escape: { code: "Escape", keyCode: 27 },
  Delete: { code: "Delete", keyCode: 46 },
  ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
  ArrowUp: { code: "ArrowUp", keyCode: 38 },
  ArrowRight: { code: "ArrowRight", keyCode: 39 },
  ArrowDown: { code: "ArrowDown", keyCode: 40 },
  Home: { code: "Home", keyCode: 36 },
  End: { code: "End", keyCode: 35 },
  PageUp: { code: "PageUp", keyCode: 33 },
  PageDown: { code: "PageDown", keyCode: 34 },
};

export function isRelayedKey(key: string): boolean {
  return key in KEYS;
}

type Listener<T> = (value: T) => void;

/**
 * Le navigateur que Claude pilote par son MCP, vu depuis Clide : Clide le lance
 * (ou reprend celui qui écoute déjà sur le port), suit ses pages, et en diffuse
 * l'image tant qu'une page de l'interface la regarde — pas au-delà, le flux
 * coûte.
 */
export class ClaudeBrowser {
  readonly #dataDir: string;
  readonly #port: number;
  #state: BrowserState;
  #connection: CdpConnection | undefined;
  #child: ChildProcess | undefined;
  #starting: Promise<void> | undefined;
  #watchers = 0;
  /** Session attachée à la page montrée, et la page qu'elle suit. */
  #attached: { targetId: string; sessionId: string; casting: boolean } | undefined;
  #attaching: Promise<void> | undefined;
  #lastFrame: BrowserFrame | undefined;
  readonly #stateListeners = new Set<Listener<BrowserState>>();
  readonly #frameListeners = new Set<Listener<BrowserFrame>>();

  constructor(dataDir: string, port = BROWSER_PORT) {
    this.#dataDir = dataDir;
    this.#port = port;
    this.#state = { status: "stopped", port, pages: [] };
  }

  get state(): BrowserState {
    return this.#state;
  }

  onState(listener: Listener<BrowserState>): () => void {
    this.#stateListeners.add(listener);
    return () => this.#stateListeners.delete(listener);
  }

  onFrame(listener: Listener<BrowserFrame>): () => void {
    this.#frameListeners.add(listener);
    return () => this.#frameListeners.delete(listener);
  }

  #setState(patch: Partial<BrowserState>): void {
    this.#state = { ...this.#state, ...patch };
    if (patch.status && patch.status !== "error") delete this.#state.error;
    for (const listener of this.#stateListeners) listener(this.#state);
  }

  /** Lance le navigateur, ou se branche sur celui qui écoute déjà sur le port. */
  start(): Promise<void> {
    if (this.#connection && !this.#connection.closed) return Promise.resolve();
    this.#starting ??= this.#start().finally(() => {
      this.#starting = undefined;
    });
    return this.#starting;
  }

  async #start(): Promise<void> {
    this.#setState({ status: "starting" });
    try {
      let endpoint = await browserEndpoint(this.#port);
      if (!endpoint) {
        const executable = await findBrowser();
        if (!executable) throw new Error("ni Chrome ni Edge n'est installé");
        const launched = await launchBrowser(executable, this.#dataDir, this.#port);
        this.#child = launched.child;
        this.#child.once("exit", () => {
          this.#child = undefined;
        });
        endpoint = launched.endpoint;
      }
      await this.#connect(endpoint);
      this.#setState({ status: "running" });
    } catch (error) {
      this.#setState({ status: "error", error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  async #connect(endpoint: string): Promise<void> {
    const connection = await CdpConnection.open(endpoint);
    this.#connection = connection;
    connection.on("close", () => {
      if (this.#connection !== connection) return;
      this.#connection = undefined;
      this.#attached = undefined;
      this.#setState({ status: "stopped", pages: [], current: undefined });
    });
    const upsert = (info: { targetId: string; type: string; url: string; title: string }, created: boolean) => {
      if (info.type !== "page") return;
      const page = { id: info.targetId, url: info.url, title: info.title };
      const known = this.#state.pages.some((item) => item.id === page.id);
      const pages = known ? this.#state.pages.map((item) => (item.id === page.id ? page : item)) : [...this.#state.pages, page];
      // Une page qui s'ouvre est celle que Claude vient de lancer : on la suit.
      const current = created || !this.#state.current ? page.id : this.#state.current;
      this.#setState({ pages, current });
      void this.#follow();
    };
    connection.on("Target.targetCreated", (params) => upsert(params["targetInfo"] as never, true));
    connection.on("Target.targetInfoChanged", (params) => upsert(params["targetInfo"] as never, false));
    connection.on("Target.targetDestroyed", (params) => {
      const id = params["targetId"] as string;
      const pages = this.#state.pages.filter((page) => page.id !== id);
      const current = this.#state.current === id ? pages.at(-1)?.id : this.#state.current;
      if (this.#attached?.targetId === id) this.#attached = undefined;
      this.#setState({ pages, current });
      void this.#follow();
    });
    connection.on("Page.screencastFrame", (params, sessionId) => {
      if (sessionId !== this.#attached?.sessionId) return;
      void connection.send("Page.screencastFrameAck", { sessionId: params["sessionId"] }, sessionId).catch(() => undefined);
      const metadata = params["metadata"] as { deviceWidth: number; deviceHeight: number };
      const frame = { data: params["data"] as string, width: metadata.deviceWidth, height: metadata.deviceHeight };
      this.#lastFrame = frame;
      for (const listener of this.#frameListeners) listener(frame);
    });
    // Un titre changé ou une navigation dans la page ne passe pas toujours par
    // `targetInfoChanged` : la page attachée le dit, et on relit ses infos.
    const refresh = (_params: Record<string, unknown>, sessionId?: string) => {
      const attached = this.#attached;
      if (!attached || sessionId !== attached.sessionId) return;
      void connection
        .send("Target.getTargetInfo", { targetId: attached.targetId })
        .then((result) => upsert(result["targetInfo"] as never, false))
        .catch(() => undefined);
    };
    for (const event of ["Page.frameNavigated", "Page.navigatedWithinDocument", "Page.loadEventFired", "Page.domContentEventFired"]) connection.on(event, refresh);
    await connection.send("Target.setDiscoverTargets", { discover: true });
  }

  /** Attache la page montrée, et diffuse son image si quelqu'un regarde. */
  #follow(): Promise<void> {
    const run = async () => {
      const connection = this.#connection;
      if (!connection) return;
      const wanted = this.#state.current;
      const attached = this.#attached;
      if (attached && attached.targetId !== wanted) {
        this.#attached = undefined;
        await connection.send("Target.detachFromTarget", { sessionId: attached.sessionId }).catch(() => undefined);
      }
      if (!wanted) return;
      if (!this.#attached) {
        const { sessionId } = (await connection.send("Target.attachToTarget", { targetId: wanted, flatten: true })) as { sessionId: string };
        this.#attached = { targetId: wanted, sessionId, casting: false };
        await connection.send("Page.enable", {}, sessionId).catch(() => undefined);
      }
      const current = this.#attached;
      if (this.#watchers > 0 && !current.casting) {
        current.casting = true;
        await connection.send("Page.startScreencast", { format: "jpeg", quality: 70, maxWidth: 1600, maxHeight: 1600 }, current.sessionId);
      } else if (this.#watchers === 0 && current.casting) {
        current.casting = false;
        await connection.send("Page.stopScreencast", {}, current.sessionId).catch(() => undefined);
      }
    };
    // Un seul changement à la fois : deux attachements croisés laisseraient une session orpheline.
    const previous = this.#attaching ?? Promise.resolve();
    const next = previous.then(run).catch((error: unknown) => console.error("[clide] navigateur", error));
    this.#attaching = next;
    return next;
  }

  /** Une page de l'interface commence ou cesse de regarder. */
  watch(on: boolean): void {
    this.#watchers = Math.max(0, this.#watchers + (on ? 1 : -1));
    if (on && this.#lastFrame) for (const listener of this.#frameListeners) listener(this.#lastFrame);
    void this.#follow();
  }

  select(id: string): void {
    if (!this.#state.pages.some((page) => page.id === id)) throw new Error("page inconnue");
    this.#lastFrame = undefined;
    this.#setState({ current: id });
    void this.#follow();
  }

  async navigate(url: string): Promise<void> {
    const connection = this.#connection;
    if (!connection) throw new Error("le navigateur ne tourne pas");
    const target = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
    await this.#follow();
    if (!this.#attached) {
      await connection.send("Target.createTarget", { url: target });
      return;
    }
    await connection.send("Page.navigate", { url: target }, this.#attached.sessionId);
  }

  async input(event: BrowserInput): Promise<void> {
    const connection = this.#connection;
    await this.#follow();
    const sessionId = this.#attached?.sessionId;
    if (!connection || !sessionId) throw new Error("aucune page à piloter");
    const send = (method: string, params: Record<string, unknown>) => connection.send(method, params, sessionId);
    switch (event.kind) {
      case "click": {
        const base = { x: event.x, y: event.y, button: event.button ?? "left", clickCount: 1 };
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: event.x, y: event.y });
        await send("Input.dispatchMouseEvent", { type: "mousePressed", ...base });
        await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...base });
        return;
      }
      case "move":
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: event.x, y: event.y });
        return;
      case "wheel":
        await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: event.x, y: event.y, deltaX: event.deltaX, deltaY: event.deltaY });
        return;
      case "text":
        await send("Input.insertText", { text: event.text });
        return;
      case "key": {
        const key = KEYS[event.key];
        if (!key) throw new Error(`touche non relayée : ${event.key}`);
        const base = { key: event.key, code: key.code, windowsVirtualKeyCode: key.keyCode };
        await send("Input.dispatchKeyEvent", { type: key.text ? "keyDown" : "rawKeyDown", ...base, ...(key.text ? { text: key.text } : {}) });
        await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
        return;
      }
    }
  }

  /** Arrête le navigateur : celui que Clide a lancé, ou celui qu'il a repris sur son port. */
  async stop(): Promise<void> {
    const connection = this.#connection;
    this.#connection = undefined;
    this.#attached = undefined;
    this.#lastFrame = undefined;
    if (this.#child) {
      this.#child.kill();
      this.#child = undefined;
      connection?.close();
    } else if (connection) {
      await connection.send("Browser.close").catch(() => undefined);
      connection.close();
    }
    this.#setState({ status: "stopped", pages: [], current: undefined });
  }
}
