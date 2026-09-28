import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { SettingsEditor, appDataDir, legacyAppDataDir, roamingDir, settingsFile, type SettingsEdit } from "@clide/core";

import { nodeExecutable } from "../platform/node-path.js";

/**
 * Ce que l'application sait faire d'un événement de hook.
 *
 * `resume` et `session` ne sont pas des alertes : le premier signale que la
 * session repart, et éteint la pastille de l'onglet au lieu d'en allumer une ;
 * le second dit quelle session l'onglet suit désormais, et le rattache.
 */
export type NotificationKind = "permission" | "idle" | "stop" | "resume" | "session" | "other";

type HookEvent = "Notification" | "Stop" | "UserPromptSubmit" | "SessionStart";

/**
 * Hooks déclarés dans `settings.json`.
 *
 * Le type de notification est passé **en argument du script**, pas lu dans la
 * charge utile : c'est le `matcher` qui filtre le type côté Claude Code, et une
 * entrée par type nous le fait connaître sans dépendre d'un champ que la
 * documentation ne fixe pas.
 *
 * `Stop` et `UserPromptSubmit` n'acceptent pas de `matcher` — en poser un ferait
 * taire le hook.
 *
 * La reprise est lue sur `UserPromptSubmit`, qui tire une fois par prompt, et non
 * sur `PreToolUse` : ce dernier tirerait à chaque appel d'outil et lancerait un
 * processus Node dans le chemin critique de chacun.
 */
export const HOOK_DEFINITIONS: { event: HookEvent; matcher?: string; kind: NotificationKind }[] = [
  { event: "Notification", matcher: "permission_prompt", kind: "permission" },
  { event: "Notification", matcher: "idle_prompt|agent_needs_input", kind: "idle" },
  { event: "Stop", kind: "stop" },
  { event: "UserPromptSubmit", kind: "resume" },
  // Sans matcher : au démarrage, à la reprise, après /clear et après une
  // compaction — chaque fois que l'onglet change de transcript.
  { event: "SessionStart", kind: "session" },
];

const HOOK_EVENTS = [...new Set(HOOK_DEFINITIONS.map((definition) => definition.event))];

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
// Généré par Clide. Déverse la charge utile d'un hook dans un dossier surveillé.
// Toute modification sera écrasée à la prochaine installation.
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
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
    // Écrit à côté puis renommé : le renommage est atomique, et l'application ne
    // lit jamais un fichier à moitié écrit.
    const target = join(directory, name);
    // L'onglet d'où vient l'événement : Clide le nomme dans l'environnement du
    // claude qu'il lance, et claude le transmet à ses hooks.
    const terminalId = process.env.CLIDE_TERMINAL_ID || undefined;
    const envelope = { v: 2, kind, receivedAt: new Date().toISOString(), terminalId, payload };
    writeFileSync(target + ".tmp", JSON.stringify(envelope), "utf8");
    renameSync(target + ".tmp", target);
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

/** Commande inscrite dans `settings.json` pour un type donné. `node` : voir `nodeExecutable`. */
export function hookCommand(
  kind: NotificationKind,
  dataDir: string = appDataDir(),
  node: string = process.execPath,
): string {
  return `"${node}" "${hookScriptPath(dataDir)}" ${kind} "${eventsDir(dataDir)}"`;
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

/**
 * Scripts des installations antérieures, reconnus dans `settings.json` à leur
 * chemin : le premier nom de l'application déposait un `hook.cmd` dans le profil
 * itinérant, claude-ide un `hook.mjs` dans son dossier de données. Leurs entrées
 * déversent dans un dossier que rien ne lit, ou appellent un script disparu.
 */
export function legacyHookScripts(env: NodeJS.ProcessEnv = process.env): string[] {
  return [join(legacyAppDataDir(env), "hook.mjs"), join(roamingDir(env), "ClaudeTerm", "hook.cmd")];
}

/** Hooks d'une installation antérieure encore déclarés, avec les événements qui les portent. */
export interface LegacyHooks {
  script: string;
  events: string[];
}

export interface HooksStatus {
  installed: boolean;
  /** Le script déposé n'est plus celui de cette version : réinstaller le remplace. */
  outdated: boolean;
  /** Types effectivement déclarés, pour distinguer une installation partielle. */
  kinds: NotificationKind[];
  legacy: LegacyHooks[];
  scriptPath: string;
  eventsPath: string;
  settingsPath: string;
}

export async function hooksStatus(
  dataDir: string = appDataDir(),
  file: string = settingsFile(),
  legacyScripts: string[] = legacyHookScripts(),
): Promise<HooksStatus> {
  const settings = await new SettingsEditor().read(file);
  const hooks = (settings.value["hooks"] ?? {}) as Record<string, unknown>;
  const scriptPath = hookScriptPath(dataDir);

  const kinds = HOOK_DEFINITIONS.filter((definition) =>
    entriesOf(hooks[definition.event]).some((entry) => isOurs(entry, scriptPath)),
  ).map((definition) => definition.kind);
  const deployed = kinds.length > 0 ? await readFile(scriptPath, "utf8").catch(() => undefined) : undefined;
  const legacy = legacyScripts
    .map((script) => ({
      script,
      events: Object.keys(hooks).filter((event) => entriesOf(hooks[event]).some((entry) => isOurs(entry, script))),
    }))
    .filter((item) => item.events.length > 0);

  return {
    installed: kinds.length === HOOK_DEFINITIONS.length,
    outdated: kinds.length > 0 && deployed !== hookScript(),
    kinds,
    legacy,
    scriptPath,
    eventsPath: eventsDir(dataDir),
    settingsPath: file,
  };
}

/**
 * Retire les entrées qui appellent l'un des scripts, sur tous les événements du
 * fichier ; une clé vidée disparaît, le reste ne bouge pas.
 */
async function removeEntries(file: string, scripts: string[]): Promise<void> {
  const editor = new SettingsEditor();
  const settings = await editor.read(file);
  const hooks = (settings.value["hooks"] ?? {}) as Record<string, unknown>;

  const edits: SettingsEdit[] = [];
  for (const event of Object.keys(hooks)) {
    const all = entriesOf(hooks[event]);
    const kept = all.filter((entry) => !scripts.some((script) => isOurs(entry, script)));
    if (kept.length === all.length) continue;
    edits.push({ path: ["hooks", event], value: kept.length > 0 ? kept : undefined });
  }
  if (edits.length > 0) await editor.update(file, edits);
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
  const node = await nodeExecutable();
  await mkdir(dirname(hookScriptPath(dataDir)), { recursive: true });
  await writeFile(hookScriptPath(dataDir), hookScript(), "utf8");
  await mkdir(eventsDir(dataDir), { recursive: true });

  const editor = new SettingsEditor();
  const settings = await editor.read(file);
  const hooks = (settings.value["hooks"] ?? {}) as Record<string, unknown>;
  const scriptPath = hookScriptPath(dataDir);

  const edits: SettingsEdit[] = [];
  for (const event of HOOK_EVENTS) {
    const kept = entriesOf(hooks[event]).filter((entry) => !isOurs(entry, scriptPath));
    const ours = HOOK_DEFINITIONS.filter((definition) => definition.event === event).map((definition) => ({
      ...(definition.matcher ? { matcher: definition.matcher } : {}),
      hooks: [{ type: "command", command: hookCommand(definition.kind, dataDir, node) }],
    }));
    edits.push({ path: ["hooks", event], value: [...kept, ...ours] });
  }

  await editor.update(file, edits);
  return hooksStatus(dataDir, file);
}

/**
 * Repointe les hooks d'une installation antérieure : leurs entrées, reconnues à
 * leur script, sont retirées et les nôtres posées — les hooks avaient été
 * voulus, seul le script appelé change. Rend les scripts repris ; rien n'est
 * posé là où rien ne l'était.
 */
export async function migrateHooks(
  legacyScripts: string[],
  dataDir: string = appDataDir(),
  file: string = settingsFile(),
): Promise<string[]> {
  const { legacy } = await hooksStatus(dataDir, file, legacyScripts);
  if (legacy.length === 0) return [];
  await removeEntries(file, legacy.map((item) => item.script));
  await installHooks(dataDir, file);
  return legacy.map((item) => item.script);
}

/** Retire les hooks d'une installation antérieure sans rien poser : le geste « Retirer » du panneau. */
export async function pruneLegacyHooks(
  dataDir: string = appDataDir(),
  file: string = settingsFile(),
  legacyScripts: string[] = legacyHookScripts(),
): Promise<HooksStatus> {
  await removeEntries(file, legacyScripts);
  return hooksStatus(dataDir, file, legacyScripts);
}

/** Retire nos entrées et laisse le reste intact. Une clé vidée est supprimée. */
export async function uninstallHooks(
  dataDir: string = appDataDir(),
  file: string = settingsFile(),
): Promise<HooksStatus> {
  await removeEntries(file, [hookScriptPath(dataDir)]);
  return hooksStatus(dataDir, file);
}
