/**
 * Accès à l'API locale.
 *
 * Le jeton est lu une fois dans l'URL d'ouverture et rattaché à chaque appel :
 * le serveur le réclame sur toute requête, y compris la négociation WebSocket.
 */
export const TOKEN = new URLSearchParams(location.search).get("token") ?? "";

type Params = Record<string, string | number | boolean | undefined | null>;

/**
 * Envoi en cours de la liste des projets ouverts. Le serveur n'agit que dans les
 * dossiers qu'elle couvre : un appel parti avant elle, sur un projet qu'on vient
 * d'ouvrir, serait refusé.
 */
let workspaceSync: Promise<unknown> = Promise.resolve();

/** Dit au serveur quels projets sont ouverts ; les appels suivants attendent sa réponse. */
export function syncWorkspace(projects: string[]): void {
  const previous = workspaceSync;
  workspaceSync = previous
    .catch(() => undefined)
    .then(() => request("/api/workspace/roots", {}, { method: "POST", body: JSON.stringify({ projects }) }))
    .catch((error: unknown) => console.error("[clide]", error));
}

export async function api<T>(path: string, params: Params = {}, init?: RequestInit): Promise<T> {
  await workspaceSync;
  return request<T>(path, params, init);
}

async function request<T>(path: string, params: Params = {}, init?: RequestInit): Promise<T> {
  const url = new URL(path, location.origin);
  url.searchParams.set("token", TOKEN);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, init);
  const body: unknown = await response.json();
  if (!response.ok) {
    const message = (body as { error?: string }).error ?? `HTTP ${response.status}`;
    // Le code accompagne le message : un 409 (fichier changé sur disque) ne se traite pas comme un refus.
    throw Object.assign(new Error(message), { status: response.status });
  }
  return body as T;
}

/**
 * Enregistre une image côté serveur et rend son chemin, à taper dans le prompt.
 * Elle part brute : encodée dans du JSON, elle dépasserait la limite des mutations.
 */
export async function saveImage(image: Blob): Promise<string> {
  const { path } = await api<{ path: string }>("/api/attachments", {}, {
    method: "POST",
    headers: { "content-type": image.type || "image/png" },
    body: image,
  });
  return path;
}

/** Appel d'une route qui écrit. Elles sont toutes réservées à POST. */
/**
 * Adresse d'une page du guide, servi par le serveur de l'application sous `/docs/`.
 * `page` est le nom du fichier sans extension, suivi au besoin d'une ancre :
 * `session#captures`. Le guide se sert sans jeton, il n'en porte donc pas.
 */
export function docUrl(page = ""): string {
  const [file = "", anchor] = page.split("#");
  return `/docs/${file ? `${file}.html` : ""}${anchor ? `#${anchor}` : ""}`;
}

/** Ouvre le guide à côté de l'application : un onglet du navigateur, ou le navigateur du système sous Electron. */
export function openDoc(page?: string): void {
  window.open(docUrl(page), "_blank", "noreferrer");
}

export function post<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, {}, { method: "POST", body: JSON.stringify(body) });
}

/**
 * Demande un dossier ou un fichier par la fenêtre de sélection du système. Rend
 * `undefined` sur une annulation.
 *
 * Sous Electron, la boîte de dialogue native, modale à la fenêtre. Dans un
 * navigateur, la page ne voit jamais le chemin d'un fichier : c'est le serveur,
 * sur le même poste, qui ouvre la fenêtre de Windows.
 */
export async function pickPath(request: PickRequest): Promise<string | undefined> {
  const desktop = window.clide;
  if (desktop?.pick) return desktop.pick(request);
  const { path } = await post<{ path?: string }>("/api/pick", request);
  return path;
}

export function socketUrl(path: string): string {
  const url = new URL(path, location.origin);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", TOKEN);
  return url.toString();
}

/** Type des chemins glissés depuis le Finder de l'application. */
export const PATHS_MIME = "application/x-clide-paths";

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
