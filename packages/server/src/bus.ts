import type { ServerMessage, WatchTopic } from "./protocol.js";

/** Ce qui se passe dans le serveur et que des modules veulent savoir. */
export interface BusEvents {
  /** Les projets ouverts dans l'interface ont changé. */
  roots: (roots: readonly string[]) => void;
  /** Des fichiers viennent d'être écrits, créés, déplacés ou mis à la corbeille par l'API. */
  files: (paths: readonly string[]) => void;
  /** Un message à envoyer à toutes les pages connectées. */
  broadcast: (message: ServerMessage) => void;
  /** Une page commence ou cesse de regarder un flux ; une page fermée cesse de tout regarder. */
  watch: (topic: WatchTopic, on: boolean) => void;
}

type Listener = (...args: unknown[]) => void;

/**
 * Canal interne du serveur : les routes y annoncent ce qu'elles ont fait, les
 * modules s'y abonnent, les connexions WebSocket y lisent ce qu'il faut pousser.
 * Un abonné qui lève n'empêche pas les autres d'être prévenus.
 */
export class ServerBus {
  readonly #listeners = new Map<keyof BusEvents, Set<Listener>>();

  on<K extends keyof BusEvents>(event: K, listener: BusEvents[K]): () => void {
    const set = this.#listeners.get(event) ?? new Set<Listener>();
    set.add(listener as unknown as Listener);
    this.#listeners.set(event, set);
    return () => set.delete(listener as unknown as Listener);
  }

  emit<K extends keyof BusEvents>(event: K, ...args: Parameters<BusEvents[K]>): void {
    for (const listener of this.#listeners.get(event) ?? []) {
      try {
        listener(...args);
      } catch (error) {
        console.error(`[clide] abonné de ${event}`, error);
      }
    }
  }
}
