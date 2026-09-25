import { TOKEN, api, post } from "@/lib/api";

/** Clé de l'état mémorisé dans `localStorage`. */
export const SAVED = "clide.state";
/** Clé des versions antérieures au nom Clide, relue tant que la nouvelle n'existe pas. */
export const LEGACY_SAVED = "claude-ide.state";

/** Au-delà, le serveur est tenu pour absent : la page s'ouvre sur ce qu'elle a. */
const HYDRATE_TIMEOUT_MS = 2000;
/** Regroupe les changements rapprochés, un glissement de séparateur par exemple. */
const SAVE_DELAY_MS = 400;

/**
 * Recopie dans `localStorage` l'état gardé par le serveur, avant que le store ne
 * le lise.
 *
 * `localStorage` est propre à une origine, et le port du serveur change d'un
 * lancement à l'autre : seul, il rouvrirait l'application sans ses projets. La
 * copie du serveur fait donc foi. Absente, la mémoire locale reste telle quelle,
 * et sera envoyée au serveur à la première écriture.
 */
export async function hydrateSavedState(): Promise<void> {
  try {
    const { state } = await api<{ state: unknown }>("/api/ui-state", {}, {
      signal: AbortSignal.timeout(HYDRATE_TIMEOUT_MS),
    });
    if (state && typeof state === "object") localStorage.setItem(SAVED, JSON.stringify(state));
  } catch {
    // Serveur injoignable ou mémoire du navigateur bloquée : on part de ce qu'on a.
  }
}

let lastSent: string | undefined;
let pending: string | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

function flush(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
  if (pending === undefined || pending === lastSent) return;
  const text = pending;
  lastSent = text;
  void post("/api/ui-state/save", { state: JSON.parse(text) as unknown }).catch(() => {
    // Réessayé au prochain changement.
    lastSent = undefined;
  });
}

/** Envoie l'état au serveur, une fois les changements rapprochés retombés. */
export function saveRemote(text: string): void {
  if (text === lastSent) return;
  pending = text;
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, SAVE_DELAY_MS);
}

// Une fermeture pendant le délai perdrait le dernier changement : `sendBeacon`
// part même quand la page se décharge, là où un `fetch` serait interrompu.
addEventListener("pagehide", () => {
  if (timer) clearTimeout(timer);
  timer = undefined;
  if (pending === undefined || pending === lastSent) return;
  const url = new URL("/api/ui-state/save", location.origin);
  url.searchParams.set("token", TOKEN);
  navigator.sendBeacon(url, new Blob([JSON.stringify({ state: JSON.parse(pending) as unknown })], { type: "application/json" }));
  lastSent = pending;
});
