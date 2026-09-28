import { api, post } from "@/lib/api";
import type { BrowserFrame, BrowserState } from "@/lib/types";
import { setState } from "@/state/store";
import { serverSocket } from "@/state/terminals";

/**
 * L'image du navigateur de Claude. Les images passent hors du store : elles
 * arrivent plusieurs fois par seconde, et seule la vue de l'aperçu les veut.
 * Le serveur ne les produit que tant qu'une vue est abonnée.
 */

const listeners = new Set<(frame: BrowserFrame) => void>();
let last: BrowserFrame | undefined;

export function pushBrowserFrame(frame: BrowserFrame): void {
  last = frame;
  for (const listener of listeners) listener(frame);
}

let resubscribing = false;

/** S'abonne aux images ; le premier abonné les fait produire, le dernier parti les arrête. */
export function watchBrowser(listener: (frame: BrowserFrame) => void): () => void {
  // Enregistré au premier abonnement, pas au chargement : `terminals` importe ce
  // module et n'est pas encore initialisé quand celui-ci s'évalue.
  if (!resubscribing) {
    resubscribing = true;
    // Une reconnexion perd l'abonnement côté serveur : on le redemande.
    serverSocket.onOpen(() => {
      if (listeners.size > 0) serverSocket.send({ t: "watch", topic: "browser", on: true });
    });
  }
  listeners.add(listener);
  if (listeners.size === 1) serverSocket.send({ t: "watch", topic: "browser", on: true });
  if (last) listener(last);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) serverSocket.send({ t: "watch", topic: "browser", on: false });
  };
}

export interface BrowserInfo {
  state: BrowserState;
  mcp: { name: string; port: number; configs: Record<"chrome-devtools" | "playwright", { command: string; args: string[] }> };
}

export async function loadBrowser(): Promise<BrowserInfo> {
  const info = await api<BrowserInfo>("/api/browser");
  setState({ browser: info.state });
  return info;
}

export async function browserAction(action: "start" | "stop"): Promise<void> {
  const { state } = await post<{ state: BrowserState }>(`/api/browser/${action}`, {});
  if (action === "stop") last = undefined;
  setState({ browser: state });
}

export function selectBrowserPage(id: string): Promise<unknown> {
  last = undefined;
  return post("/api/browser/select", { id });
}

export function navigateBrowser(url: string): Promise<unknown> {
  return post("/api/browser/navigate", { url });
}

export type BrowserInput =
  | { kind: "click"; x: number; y: number; button?: "left" | "middle" | "right" }
  | { kind: "wheel"; x: number; y: number; deltaX: number; deltaY: number }
  | { kind: "text"; text: string }
  | { kind: "key"; key: string };

export function sendBrowserInput(event: BrowserInput): Promise<unknown> {
  return post("/api/browser/input", { event });
}

export function connectBrowserMcp(root: string, kind: "chrome-devtools" | "playwright"): Promise<{ output: string }> {
  return post<{ output: string }>("/api/browser/mcp", { root, kind });
}
