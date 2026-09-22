import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { SettingsEditor, appDataDir, settingsFile, type SettingsEdit } from "@claude-ide/core";

/** Ce que l'application sait faire d'un événement de hook. */
export type NotificationKind = "permission" | "idle" | "stop" | "other";

/**
 * Hooks déclarés dans `settings.json`.
 *
 * Le type de notification est passé **en argument du script**, pas lu dans la
 * charge utile : c'est le `matcher` qui filtre le type côté Claude Code, et une
 * entrée par type nous le fait connaître sans dépendre d'un champ que la
 * documentation ne fixe pas.
 *
 * `Stop` n'accepte pas de `matcher` — en poser un ferait taire le hook.
 */
export const HOOK_DEFINITIONS: { event: "Notification" | "Stop"; matcher?: string; kind: NotificationKind }[] = [
  { event: "Notification", matcher: "permission_prompt", kind: "permission" },
  { event: "Notification", matcher: "idle_prompt|agent_needs_input", kind: "idle" },
  { event: "Stop", kind: "stop" },
];

export function eventsDir(dataDir: string = appDataDir()): string {
  return join(dataDir, "hook-events");
}

export function hookScriptPath(dataDir: string = appDataDir()): string {
  return join(dataDir, "hook.mjs");
}

/**
 * Script déposé par l'installation, appelé par Claude Code à chaque événement.
 *
 * Il ne fait qu'une chose : déverser la charge utile dans un dossier que
 * l'application surveille. Toute la logique reste côté serveur, parce qu'un hook
 * s'exécute **dans le chemin critique de la session** — il doit rendre la main
 * tout de suite et ne jamais échouer, sous peine de ralentir ou d'interrompre le
 * travail de l'utilisateur.
 */
export function hookScript(): string {
  return `#!/usr/bin/env node
// Généré par claude-ide. Déverse la charge utile d'un hook dans un dossier surveillé.
// Toute modification sera écrasée à la prochaine installation.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const kind = process.argv[2] ?? "other";
const directory = process.argv[3] ?? "";

let raw = "";
let done = false;

function spool() {
  if (done) return;
  done = true;
  try {
    mkdirSync(directory, { recursive: true });
    const name = Date.now() + "-" + process.pid + "-" + Math.random().toString(36).slice(2, 8) + ".json";
    let payload = null;
    try { payload = JSON.parse(raw); } catch { payload = { raw: raw.slice(0, 2000) }; }
    writeFileSync(join(directory, name), JSON.stringify({ kind, receivedAt: new Date().toISOString(), payload }), "utf8");
  } catch {
    // Un hook qui échoue ne doit pas remonter à la session : il n'y a rien à
    // sauver ici, et une erreur coûterait plus cher que l'événement perdu.
  }
  process.exit(0);
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", spool);
process.stdin.on("error", spool);
// Filet : si l'entrée standard n'est jamais close, on n'immobilise pas la session.
setTimeout(spool, 2000).unref();
`;
}

/** Commande inscrite dans `settings.json` pour un type donné. */
export function hookCommand(kind: NotificationKind, dataDir: string = appDataDir()): string {
  // Le chemin absolu de l'exécutable Node courant plutôt que `node` : le hook
  // s'exécute dans l'environnement de Claude Code, dont le PATH n'est pas le nôtre.
  return `"${process.execPath}" "${hookScriptPath(dataDir)}" ${kind} "${eventsDir(dataDir)}"`;
}

interface HookEntry {
  matcher?: string;
  hooks?: { type?: string; command?: string }[];
}

function entriesOf(value: unknown): HookEntry[] {
  return Array.isArray(value) ? (value as HookEntry[]) : [];
}

/** Vrai si l'entrée est l'une des nôtres, reconnue à son script. */
function isOurs(entry: HookEntry, scriptPath: string): boolean {
  return (entry.hooks ?? []).some((hook) => (hook.command ?? "").includes(scriptPath));
}

export interface HooksStatus {
  installed: boolean;
  /** Types effectivement déclarés, pour distinguer une installation partielle. */
  kinds: NotificationKind[];
  scriptPath: string;
  eventsPath: string;
  settingsPath: string;
}

export async function hooksStatus(
  dataDir: string = appDataDir(),
  file: string = settingsFile(),
): Promise<HooksStatus> {
  const settings = await new SettingsEditor().read(file);
  const hooks = (settings.value["hooks"] ?? {}) as Record<string, unknown>;
  const scriptPath = hookScriptPath(dataDir);

  const kinds = HOOK_DEFINITIONS.filter((definition) =>
    entriesOf(hooks[definition.event]).some((entry) => isOurs(entry, scriptPath)),
  ).map((definition) => definition.kind);

  return {
    installed: kinds.length === HOOK_DEFINITIONS.length,
    kinds,
    scriptPath,
    eventsPath: eventsDir(dataDir),
    settingsPath: file,
  };
}

/**
 * Déclare les hooks dans `settings.json`.
 *
 * Les entrées existantes sont conservées : `settings.json` porte souvent des
 * hooks posés à la main sur les mêmes événements, et les remplacer casserait des
 * outils sans rapport avec celui-ci. Une réinstallation remplace nos entrées
 * plutôt que de les empiler.
 */
export async function installHooks(
  dataDir: string = appDataDir(),
  file: string = settingsFile(),
): Promise<HooksStatus> {
  await mkdir(dirname(hookScriptPath(dataDir)), { recursive: true });
  await writeFile(hookScriptPath(dataDir), hookScript(), "utf8");
  await mkdir(eventsDir(dataDir), { recursive: true });

  const editor = new SettingsEditor();
  const settings = await editor.read(file);
  const hooks = (settings.value["hooks"] ?? {}) as Record<string, unknown>;
  const scriptPath = hookScriptPath(dataDir);

  const edits: SettingsEdit[] = [];
  for (const event of ["Notification", "Stop"] as const) {
    const kept = entriesOf(hooks[event]).filter((entry) => !isOurs(entry, scriptPath));
    const ours = HOOK_DEFINITIONS.filter((definition) => definition.event === event).map((definition) => ({
      ...(definition.matcher ? { matcher: definition.matcher } : {}),
      hooks: [{ type: "command", command: hookCommand(definition.kind, dataDir) }],
    }));
    edits.push({ path: ["hooks", event], value: [...kept, ...ours] });
  }

  await editor.update(file, edits);
  return hooksStatus(dataDir, file);
}

/** Retire nos entrées et laisse le reste intact. Une clé vidée est supprimée. */
export async function uninstallHooks(
  dataDir: string = appDataDir(),
  file: string = settingsFile(),
): Promise<HooksStatus> {
  const editor = new SettingsEditor();
  const settings = await editor.read(file);
  const hooks = (settings.value["hooks"] ?? {}) as Record<string, unknown>;
  const scriptPath = hookScriptPath(dataDir);

  const edits: SettingsEdit[] = [];
  for (const event of ["Notification", "Stop"] as const) {
    const kept = entriesOf(hooks[event]).filter((entry) => !isOurs(entry, scriptPath));
    edits.push({ path: ["hooks", event], value: kept.length > 0 ? kept : undefined });
  }

  await editor.update(file, edits);
  return hooksStatus(dataDir, file);
}
