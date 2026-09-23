/**
 * Accès à l'API locale.
 *
 * Le jeton est lu une fois dans l'URL d'ouverture et rattaché à chaque appel :
 * le serveur le réclame sur toute requête, y compris la négociation WebSocket.
 */
export const TOKEN = new URLSearchParams(location.search).get("token") ?? "";

type Params = Record<string, string | number | boolean | undefined | null>;

export async function api<T>(path: string, params: Params = {}, init?: RequestInit): Promise<T> {
  const url = new URL(path, location.origin);
  url.searchParams.set("token", TOKEN);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, init);
  const body: unknown = await response.json();
  if (!response.ok) {
    const message = (body as { error?: string }).error ?? `HTTP ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

/** Appel d'une route qui écrit. Elles sont toutes réservées à POST. */
export function post<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, {}, { method: "POST", body: JSON.stringify(body) });
}

export function socketUrl(path: string): string {
  const url = new URL(path, location.origin);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", TOKEN);
  return url.toString();
}

/** Type des chemins glissés depuis le Finder de l'application. */
export const PATHS_MIME = "application/x-claude-ide-paths";

/** Chemin tel qu'on le tape dans un prompt : entre guillemets s'il porte des espaces. */
export function quotePath(path: string): string {
  return path.includes(" ") ? `"${path}"` : path;
}

/** Dernier segment d'un chemin, quel que soit le séparateur. */
export function shortName(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? path;
}

export function formatDate(iso?: string): string {
  return iso ? new Date(iso).toLocaleString("fr-FR") : "";
}

export function formatTime(iso?: string): string {
  return iso ? new Date(iso).toLocaleTimeString("fr-FR") : "";
}
