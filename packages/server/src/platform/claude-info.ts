import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { newerVersion, parseClaudeVersion, parseStatusPage, type ServiceStatus } from "@clide/core";

const run = promisify(execFile);

/** Dernière version de Claude Code publiée sur npm. */
export const NPM_LATEST = "https://registry.npmjs.org/@anthropic-ai/claude-code/latest";
/** Résumé de la page de statut d'Anthropic, au format Statuspage. */
export const STATUS_URL = "https://status.claude.com/api/v2/summary.json";

/** Claude Code se met aussi à jour seul : la version installée ne se garde pas longtemps. */
const VERSION_TTL_MS = 10 * 60_000;
const LATEST_TTL_MS = 60 * 60_000;
const STATUS_TTL_MS = 5 * 60_000;
const FETCH_TIMEOUT_MS = 10_000;

export interface ClaudeInfo {
  /** Version installée ; `null` quand la CLI est introuvable ou ne répond pas. */
  version: string | null;
  /** Dernière version publiée ; `null` quand npm ne répond pas. */
  latest: string | null;
  /** La dernière version, quand elle est plus récente que celle installée. */
  update: string | null;
  status: ServiceStatus | null;
  /** Pourquoi la page de statut n'a pas pu être lue. */
  statusError?: string;
}

export interface ClaudeInfoSources {
  /** Sortie de `claude --version`. */
  runVersion: () => Promise<string>;
  fetchJson: (url: string) => Promise<unknown>;
  now: () => number;
}

/**
 * `claude --version`, par le shell comme `claude mcp list` : la CLI s'installe
 * aussi en script `.cmd`, que Node refuse de lancer directement. Les arguments
 * sont figés, rien de l'extérieur n'entre dans la ligne de commande.
 */
export async function claudeVersionOutput(): Promise<string> {
  const { stdout } = await run("claude", ["--version"], { shell: true, windowsHide: true, timeout: 15_000 });
  return stdout;
}

/** Une adresse publique, lue sans identifiant. */
export async function fetchPublicJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { "User-Agent": "Clide" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/** Ce qu'on dit d'un échec de lecture : le délai, le réseau, ou le message tel quel. */
function reasonOf(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  if (error.name === "TimeoutError") return "délai dépassé";
  const code = (error.cause as { code?: unknown } | undefined)?.code;
  if (typeof code === "string") return `réseau injoignable (${code})`;
  return error.message;
}

/**
 * Garde le résultat d'une lecture le temps de `ttlMs`. La lecture ne doit pas
 * échouer : son échec est un résultat, gardé comme les autres, pour ne pas
 * relancer une source en panne à chaque ouverture de l'onglet.
 */
function cached<T>(ttlMs: number, load: () => Promise<T>, now: () => number): (refresh: boolean) => Promise<T> {
  let entry: { at: number; value: Promise<T> } | undefined;
  return (refresh) => {
    if (refresh || !entry || now() - entry.at > ttlMs) entry = { at: now(), value: load() };
    return entry.value;
  };
}

function latestOf(body: unknown): string | undefined {
  const version = body && typeof body === "object" ? (body as Record<string, unknown>)["version"] : undefined;
  return typeof version === "string" ? parseClaudeVersion(version) : undefined;
}

/**
 * Lecteur de la version de Claude Code et de l'état des services. Chaque
 * source est gardée à part et échoue seule : sans réseau, la version installée
 * reste connue. `refresh` relit les trois.
 */
export function claudeInfoReader(sources: Partial<ClaudeInfoSources> = {}): (refresh?: boolean) => Promise<ClaudeInfo> {
  const { runVersion = claudeVersionOutput, fetchJson = fetchPublicJson, now = Date.now } = sources;
  const installed = cached(VERSION_TTL_MS, () => runVersion().then(parseClaudeVersion, () => undefined), now);
  const published = cached(LATEST_TTL_MS, () => fetchJson(NPM_LATEST).then(latestOf, () => undefined), now);
  const service = cached(
    STATUS_TTL_MS,
    () =>
      fetchJson(STATUS_URL)
        .then((body): { status: ServiceStatus } | { error: string } => ({ status: parseStatusPage(body) }))
        .catch((error: unknown) => ({ error: reasonOf(error) })),
    now,
  );

  return async (refresh = false) => {
    const [version, latest, page] = await Promise.all([installed(refresh), published(refresh), service(refresh)]);
    return {
      version: version ?? null,
      latest: latest ?? null,
      update: newerVersion(version, latest) ?? null,
      status: "status" in page ? page.status : null,
      ...("error" in page ? { statusError: page.error } : {}),
    };
  };
}
