import WebSocket from "ws";

type Params = Record<string, unknown>;
type EventListener = (params: Params, sessionId?: string) => void;

/**
 * Une connexion au protocole DevTools de Chromium, au niveau du navigateur. Les
 * pages se pilotent par des sessions attachées à plat (`flatten`) : une seule
 * socket pour tout, chaque message portant sa `sessionId`.
 */
export class CdpConnection {
  readonly #socket: WebSocket;
  readonly #pending = new Map<number, { resolve: (value: Params) => void; reject: (error: Error) => void }>();
  readonly #listeners = new Map<string, Set<EventListener>>();
  #next = 1;
  #closed = false;

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.on("message", (raw) => this.#receive(raw.toString()));
    socket.on("close", () => {
      this.#closed = true;
      for (const { reject } of this.#pending.values()) reject(new Error("connexion DevTools fermée"));
      this.#pending.clear();
      for (const listener of this.#listeners.get("close") ?? []) listener({});
    });
  }

  /** Se connecte à l'adresse WebSocket d'un navigateur (`/json/version`). */
  static open(url: string): Promise<CdpConnection> {
    return new Promise((resolve, reject) => {
      // Le navigateur refuse une origine inattendue ; sans en-tête Origin, il accepte.
      const socket = new WebSocket(url, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
      socket.once("open", () => resolve(new CdpConnection(socket)));
      socket.once("error", reject);
    });
  }

  get closed(): boolean {
    return this.#closed;
  }

  send(method: string, params: Params = {}, sessionId?: string): Promise<Params> {
    if (this.#closed) return Promise.reject(new Error("connexion DevTools fermée"));
    const id = this.#next++;
    const message = { id, method, params, ...(sessionId ? { sessionId } : {}) };
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#socket.send(JSON.stringify(message), (error) => {
        if (!error) return;
        this.#pending.delete(id);
        reject(error);
      });
    });
  }

  /** S'abonne à un événement (`Page.screencastFrame`…) ou à `close`. */
  on(event: string, listener: EventListener): () => void {
    const set = this.#listeners.get(event) ?? new Set();
    set.add(listener);
    this.#listeners.set(event, set);
    return () => set.delete(listener);
  }

  close(): void {
    this.#socket.close();
  }

  #receive(text: string): void {
    let message: { id?: number; method?: string; params?: Params; result?: Params; error?: { message: string }; sessionId?: string };
    try {
      message = JSON.parse(text) as typeof message;
    } catch {
      return;
    }
    if (message.id !== undefined) {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result ?? {});
      return;
    }
    if (!message.method) return;
    for (const listener of this.#listeners.get(message.method) ?? []) {
      try {
        listener(message.params ?? {}, message.sessionId);
      } catch (error) {
        console.error(`[clide] écouteur DevTools ${message.method}`, error);
      }
    }
  }
}
