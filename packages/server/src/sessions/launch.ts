import { join } from "node:path";

import { SettingsEditor, claudeHome } from "@clide/core";

/** Modèle et effort avec lesquels `claude` démarre, tant que son transcript ne dit rien. */
export interface ClaudeLaunch {
  model?: string;
  effort?: string;
}

/** Valeur d'une option de la ligne de commande : `--model x` ou `--model=x`. */
function option(command: string | undefined, name: string): string | undefined {
  const value = new RegExp(`(?:^|\\s)--${name}(?:=|\\s+)("[^"]*"|'[^']*'|\\S+)`).exec(command ?? "")?.[1];
  return value?.replace(/^(["'])(.*)\1$/, "$2") || undefined;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
const asString = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined);

/**
 * Modèle et effort d'un `claude` qui démarre : ceux de sa ligne de commande,
 * sinon ceux des réglages, du plus proche au plus général — local du projet,
 * partagé du projet, utilisateur. L'effort réglé pour le modèle
 * (`modelSettings.<modèle>.effortLevel`, que `/effort` écrit) prime sur
 * l'effort général. Un fichier absent ou illisible ne compte pas.
 */
export async function claudeLaunch(
  command: string | undefined,
  cwd: string,
  home: string = claudeHome(),
): Promise<ClaudeLaunch> {
  const files = [
    join(cwd, ".claude", "settings.local.json"),
    join(cwd, ".claude", "settings.json"),
    join(home, "settings.json"),
  ];
  const settings = await Promise.all(
    files.map((file) => new SettingsEditor().read(file).then((document) => document.value, () => ({}))),
  );
  const first = (pick: (value: Record<string, unknown>) => unknown) =>
    settings.map((value) => asString(pick(value))).find(Boolean);

  const model = option(command, "model") ?? first((value) => value["model"]);
  const effort =
    option(command, "effort") ??
    (model ? first((value) => asRecord(asRecord(value["modelSettings"])?.[model])?.["effortLevel"]) : undefined) ??
    first((value) => value["effortLevel"]);
  return { ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
}
