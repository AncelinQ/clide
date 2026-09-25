import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { SettingsEditor, appDataDir, claudeHome, settingsFile } from "@clide/core";

import { nodeExecutable } from "./node-path.js";

/**
 * Une limite de l'abonnement, telle que `/usage` la montre.
 *
 * `kind` reprend les noms de l'API — `session` (5 h), `weekly_all`,
 * `weekly_scoped` (un modèle), `spend` (crédit supplémentaire) — et laisse
 * passer ceux qu'on ne connaît pas encore.
 */
export interface UsageLimit {
  kind: string;
  percent: number;
  resetsAt?: string;
  /** Modèle visé par une limite restreinte. */
  model?: string;
  severity?: string;
}

/** Les limites relevées par une source, au moment dit. */
export interface UsageReading {
  at: string;
  limits: UsageLimit[];
}

/** Ce que la ligne de statut a vu d'une session. */
export interface SessionUsage {
  sessionId: string;
  at: string;
  model?: string;
  cwd?: string;
  costUsd?: number;
  durationMs?: number;
  linesAdded?: number;
  linesRemoved?: number;
  contextPercent?: number;
  contextSize?: number;
}

export interface UsageReport {
  statusline: { installed: boolean; foreign?: string; command: string };
  /** Dernier relevé de la ligne de statut, pendant une session. */
  live: UsageReading | null;
  /** Dernier relevé demandé à l'API. */
  api: (UsageReading & { subscription?: string }) | null;
  sessions: SessionUsage[];
}

export function usageDir(dataDir: string = appDataDir()): string {
  return join(dataDir, "usage");
}

export function statuslineScriptPath(dataDir: string = appDataDir()): string {
  return join(dataDir, "statusline.mjs");
}

/**
 * Script de ligne de statut, appelé par Claude Code à chaque rafraîchissement.
 *
 * Il dépose ce qu'il reçoit dans le dossier d'usage et affiche un résumé court.
 * Comme un hook, il tourne dans le chemin de la session : il ne doit ni échouer
 * ni tarder. Les limites ne sont réécrites que quand l'entrée en porte — elles
 * n'arrivent qu'après la première réponse de l'API, et une entrée qui n'en a pas
 * effacerait sinon le dernier relevé connu.
 */
export function statuslineScript(): string {
  return `#!/usr/bin/env node
// Généré par Clide. Relève l'usage transmis à la ligne de statut et en affiche un résumé.
// Toute modification sera écrasée à la prochaine installation.
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const directory = process.argv[2] ?? "";
let raw = "";
let done = false;

function save(file, value) {
  writeFileSync(file + ".tmp", JSON.stringify(value), "utf8");
  renameSync(file + ".tmp", file);
}

function percent(value) {
  return typeof value === "number" ? Math.round(value) + " %" : null;
}

function finish() {
  if (done) return;
  done = true;
  let data = null;
  try { data = JSON.parse(raw); } catch {}
  const at = new Date().toISOString();
  if (data && directory) {
    try {
      mkdirSync(join(directory, "sessions"), { recursive: true });
      if (data.rate_limits) save(join(directory, "limits.json"), { at, rate_limits: data.rate_limits });
      if (typeof data.session_id === "string" && /^[A-Za-z0-9_-]+$/.test(data.session_id)) {
        save(join(directory, "sessions", data.session_id + ".json"), {
          at,
          session_id: data.session_id,
          model: data.model?.display_name ?? data.model?.id,
          cwd: data.workspace?.current_dir ?? data.cwd,
          cost: data.cost,
          context_window: data.context_window,
        });
      }
    } catch {
      // Un relevé perdu ne vaut pas une ligne de statut vide.
    }
  }
  const parts = [];
  const limits = data?.rate_limits;
  const session = percent(limits?.five_hour?.used_percentage);
  const week = percent(limits?.seven_day?.used_percentage);
  const context = percent(data?.context_window?.used_percentage);
  if (session) parts.push("5 h " + session);
  if (week) parts.push("sem. " + week);
  if (context) parts.push("ctx " + context);
  process.stdout.write(parts.join(" · "));
  process.exit(0);
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", finish);
process.stdin.on("error", finish);
// Filet : une entrée jamais close n'immobilise pas la session.
setTimeout(finish, 2000).unref();
`;
}

export function statuslineCommand(dataDir: string = appDataDir(), node: string = process.execPath): string {
  return `"${node}" "${statuslineScriptPath(dataDir)}" "${usageDir(dataDir)}"`;
}

function commandOf(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const command = (value as { command?: unknown }).command;
  return typeof command === "string" ? command : undefined;
}

export async function statuslineStatus(
  dataDir: string = appDataDir(),
  file: string = settingsFile(),
): Promise<UsageReport["statusline"]> {
  const settings = await new SettingsEditor().read(file);
  const command = commandOf(settings.value["statusLine"]);
  const ours = command?.includes(statuslineScriptPath(dataDir)) === true;
  return {
    installed: ours,
    ...(command && !ours ? { foreign: command } : {}),
    command: command ?? "",
  };
}

/**
 * Déclare la ligne de statut dans `settings.json`.
 *
 * Claude Code n'en accepte qu'une : une ligne de statut déjà posée, qui n'est
 * pas la nôtre, n'est jamais remplacée — on la perdrait sans le dire.
 */
export async function installStatusline(
  dataDir: string = appDataDir(),
  file: string = settingsFile(),
): Promise<UsageReport["statusline"]> {
  const current = await statuslineStatus(dataDir, file);
  if (current.foreign) {
    throw new Error(`une ligne de statut est déjà configurée : ${current.foreign}`);
  }
  const node = await nodeExecutable();
  await mkdir(usageDir(dataDir), { recursive: true });
  await writeFile(statuslineScriptPath(dataDir), statuslineScript(), "utf8");
  await new SettingsEditor().update(file, [
    { path: ["statusLine"], value: { type: "command", command: statuslineCommand(dataDir, node), padding: 0 } },
  ]);
  return statuslineStatus(dataDir, file);
}

/** Retire la ligne de statut si c'est la nôtre ; une autre reste en place. */
export async function uninstallStatusline(
  dataDir: string = appDataDir(),
  file: string = settingsFile(),
): Promise<UsageReport["statusline"]> {
  const current = await statuslineStatus(dataDir, file);
  if (current.installed) await new SettingsEditor().update(file, [{ path: ["statusLine"], value: undefined }]);
  return statuslineStatus(dataDir, file);
}

// ─── Mise en forme des deux sources ─────────────────────────────────────────

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const asString = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined);

/** La ligne de statut donne les réinitialisations en secondes depuis l'époque. */
function fromEpochSeconds(value: unknown): string | undefined {
  const seconds = asNumber(value);
  return seconds === undefined ? undefined : new Date(seconds * 1000).toISOString();
}

/** Limites transmises à la ligne de statut (`rate_limits`). */
export function limitsFromStatusline(rateLimits: unknown): UsageLimit[] {
  const limits = asRecord(rateLimits) ?? {};
  const out: UsageLimit[] = [];
  for (const [key, kind] of [
    ["five_hour", "session"],
    ["seven_day", "weekly_all"],
    ["spend_limit", "spend"],
  ] as const) {
    const entry = asRecord(limits[key]);
    const percent = asNumber(entry?.["used_percentage"]);
    if (percent === undefined) continue;
    const resetsAt = fromEpochSeconds(entry?.["resets_at"]);
    out.push({ kind, percent, ...(resetsAt ? { resetsAt } : {}) });
  }
  return out;
}

/**
 * Limites de la réponse de l'API d'usage.
 *
 * Sa liste `limits` est celle que `/usage` affiche, et c'est elle qui est lue.
 * Sans elle, les champs historiques (`five_hour`, `seven_day`, `seven_day_opus`,
 * `seven_day_sonnet`) en tiennent lieu. Le crédit supplémentaire n'est compté
 * que s'il est activé : désactivé, son pourcentage ne dit rien.
 */
export function limitsFromApi(response: unknown): UsageLimit[] {
  const body = asRecord(response) ?? {};
  const out: UsageLimit[] = [];
  const listed = Array.isArray(body["limits"]) ? (body["limits"] as unknown[]) : undefined;
  if (listed) {
    for (const item of listed) {
      const entry = asRecord(item);
      const kind = asString(entry?.["kind"]);
      const percent = asNumber(entry?.["percent"]);
      if (!kind || percent === undefined) continue;
      const resetsAt = asString(entry?.["resets_at"]);
      const severity = asString(entry?.["severity"]);
      const model = asString(asRecord(asRecord(asRecord(entry?.["scope"])?.["model"]))?.["display_name"]);
      out.push({
        kind,
        percent,
        ...(resetsAt ? { resetsAt } : {}),
        ...(model ? { model } : {}),
        ...(severity ? { severity } : {}),
      });
    }
  } else {
    for (const [key, kind, model] of [
      ["five_hour", "session", undefined],
      ["seven_day", "weekly_all", undefined],
      ["seven_day_opus", "weekly_scoped", "Opus"],
      ["seven_day_sonnet", "weekly_scoped", "Sonnet"],
    ] as const) {
      const entry = asRecord(body[key]);
      const percent = asNumber(entry?.["utilization"]);
      if (percent === undefined) continue;
      const resetsAt = asString(entry?.["resets_at"]);
      out.push({ kind, percent, ...(resetsAt ? { resetsAt } : {}), ...(model ? { model } : {}) });
    }
  }
  const spend = asRecord(body["spend"]);
  const spendPercent = asNumber(spend?.["percent"]);
  if (spend?.["enabled"] === true && spendPercent !== undefined) {
    out.push({ kind: "spend", percent: spendPercent });
  }
  return out;
}

// ─── API d'usage ────────────────────────────────────────────────────────────

/** Adresse que `/usage` interroge. Non documentée : sa forme peut changer. */
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

interface Credentials {
  accessToken: string;
  expiresAt?: number;
  subscription?: string;
}

async function readCredentials(home: string): Promise<Credentials> {
  let raw: string;
  try {
    raw = await readFile(join(home, ".credentials.json"), "utf8");
  } catch {
    throw new Error("aucune connexion Claude trouvée : lance `claude` et connecte-toi");
  }
  const oauth = asRecord(asRecord(JSON.parse(raw) as unknown)?.["claudeAiOauth"]);
  const accessToken = asString(oauth?.["accessToken"]);
  if (!accessToken) throw new Error("aucune connexion claude.ai dans les identifiants de Claude Code");
  const expiresAt = asNumber(oauth?.["expiresAt"]);
  const subscription = asString(oauth?.["subscriptionType"]);
  return { accessToken, ...(expiresAt ? { expiresAt } : {}), ...(subscription ? { subscription } : {}) };
}

/**
 * Demande l'usage à l'API, avec le jeton de Claude Code, et garde la réponse.
 *
 * Le jeton n'est jamais renouvelé ici : Claude Code s'en charge à sa prochaine
 * session, et le faire à sa place pourrait invalider celui qu'il détient.
 */
export async function refreshApiUsage(
  dataDir: string = appDataDir(),
  home: string = claudeHome(),
): Promise<UsageReading & { subscription?: string }> {
  const credentials = await readCredentials(home);
  if (credentials.expiresAt && credentials.expiresAt < Date.now()) {
    throw new Error("le jeton de connexion a expiré : une session Claude le renouvellera");
  }
  const response = await fetch(USAGE_URL, {
    headers: { Authorization: `Bearer ${credentials.accessToken}`, "anthropic-beta": "oauth-2025-04-20" },
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 429) throw new Error("l'API d'usage limite les appels : réessaie dans quelques minutes");
  if (!response.ok) throw new Error(`l'API d'usage a répondu ${response.status}`);
  const reading = {
    at: new Date().toISOString(),
    limits: limitsFromApi(await response.json()),
    ...(credentials.subscription ? { subscription: credentials.subscription } : {}),
  };
  await mkdir(usageDir(dataDir), { recursive: true });
  const file = join(usageDir(dataDir), "api.json");
  await writeFile(`${file}.tmp`, JSON.stringify(reading), "utf8");
  await rename(`${file}.tmp`, file);
  return reading;
}

// ─── Lecture ────────────────────────────────────────────────────────────────

async function readJson(file: string): Promise<Record<string, unknown> | undefined> {
  try {
    return asRecord(JSON.parse(await readFile(file, "utf8")) as unknown);
  } catch {
    return undefined;
  }
}

/** Sessions montrées : les plus récentes suffisent à retrouver celle en cours. */
const SESSIONS_SHOWN = 15;

function sessionOf(raw: Record<string, unknown>): SessionUsage | undefined {
  const sessionId = asString(raw["session_id"]);
  const at = asString(raw["at"]);
  if (!sessionId || !at) return undefined;
  const cost = asRecord(raw["cost"]);
  const context = asRecord(raw["context_window"]);
  const fields: Omit<SessionUsage, "sessionId" | "at"> = {};
  const model = asString(raw["model"]);
  const cwd = asString(raw["cwd"]);
  const costUsd = asNumber(cost?.["total_cost_usd"]);
  const durationMs = asNumber(cost?.["total_duration_ms"]);
  const linesAdded = asNumber(cost?.["total_lines_added"]);
  const linesRemoved = asNumber(cost?.["total_lines_removed"]);
  const contextPercent = asNumber(context?.["used_percentage"]);
  const contextSize = asNumber(context?.["context_window_size"]);
  if (model) fields.model = model;
  if (cwd) fields.cwd = cwd;
  if (costUsd !== undefined) fields.costUsd = costUsd;
  if (durationMs !== undefined) fields.durationMs = durationMs;
  if (linesAdded !== undefined) fields.linesAdded = linesAdded;
  if (linesRemoved !== undefined) fields.linesRemoved = linesRemoved;
  if (contextPercent !== undefined) fields.contextPercent = contextPercent;
  if (contextSize !== undefined) fields.contextSize = contextSize;
  return { sessionId, at, ...fields };
}

export async function readUsage(
  dataDir: string = appDataDir(),
  file: string = settingsFile(),
): Promise<UsageReport> {
  const directory = usageDir(dataDir);
  const [statusline, limits, api] = await Promise.all([
    statuslineStatus(dataDir, file),
    readJson(join(directory, "limits.json")),
    readJson(join(directory, "api.json")),
  ]);

  const sessions: SessionUsage[] = [];
  let names: string[] = [];
  try {
    names = (await readdir(join(directory, "sessions"))).filter((name) => name.endsWith(".json"));
  } catch {
    // Pas encore de relevé.
  }
  for (const name of names) {
    const raw = await readJson(join(directory, "sessions", name));
    const session = raw && sessionOf(raw);
    if (session) sessions.push(session);
  }
  sessions.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const liveAt = asString(limits?.["at"]);
  const apiAt = asString(api?.["at"]);
  const subscription = asString(api?.["subscription"]);
  return {
    statusline,
    live: liveAt ? { at: liveAt, limits: limitsFromStatusline(limits?.["rate_limits"]) } : null,
    api: apiAt
      ? {
          at: apiAt,
          limits: Array.isArray(api?.["limits"]) ? (api["limits"] as UsageLimit[]) : [],
          ...(subscription ? { subscription } : {}),
        }
      : null,
    sessions: sessions.slice(0, SESSIONS_SHOWN),
  };
}
