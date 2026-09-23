import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { claudeHome, encodeProjectPath, projectsDir } from "../paths.js";

export interface TranscriptMatch {
  path: string;
  sessionId: string;
}

/**
 * Marge sur l'heure d'ouverture de l'onglet : l'horloge du fichier et celle de
 * l'application ne sont pas prises au même instant.
 */
const SLACK_MS = 2000;

/**
 * Session reprise par la commande de lancement, `claude --resume <id>`.
 *
 * Seule une reprise nommée est reconnue : `--continue` reprend « la plus
 * récente », qu'on ne saurait désigner qu'en devinant.
 */
export function resumedSessionId(command: string | undefined): string | undefined {
  return command?.match(/(?:^|\s)(?:--resume|-r)\s+([0-9a-f-]{36})(?:\s|$)/i)?.[1];
}

/**
 * Transcript d'une session lancée dans un onglet, trouvé sans l'aide des hooks.
 *
 * Claude Code range les sessions par dossier de lancement, et une session neuve
 * est le fichier **créé** après l'ouverture de l'onglet — le plus récent, hors
 * de ceux qu'un autre onglet suit déjà. La date de **modification** ne dit rien :
 * toute session active dans le même dossier, lancée ailleurs, écrit sans cesse
 * dans le sien, et gagnerait avant que la nouvelle ait créé son fichier.
 *
 * Une reprise nommée est suivie dans son propre transcript, sauf si Claude Code
 * en a créé un neuf pour elle.
 */
export async function findLiveTranscript(
  cwd: string,
  since: number,
  claimed: ReadonlySet<string>,
  home: string = claudeHome(),
  resumed?: string,
): Promise<TranscriptMatch | undefined> {
  const directory = join(projectsDir(home), encodeProjectPath(cwd));
  let names: string[];
  try {
    names = (await readdir(directory)).filter((name) => name.endsWith(".jsonl"));
  } catch {
    return undefined;
  }

  let created: { name: string; at: number } | undefined;
  for (const name of names) {
    const path = join(directory, name);
    if (claimed.has(path)) continue;
    let info;
    try {
      info = await stat(path);
    } catch {
      continue;
    }
    if (info.birthtimeMs > since - SLACK_MS && (!created || info.birthtimeMs > created.at)) {
      created = { name, at: info.birthtimeMs };
    }
  }

  const name = created?.name ?? (resumed && names.includes(`${resumed}.jsonl`) ? `${resumed}.jsonl` : undefined);
  if (!name || claimed.has(join(directory, name))) return undefined;
  return { path: join(directory, name), sessionId: name.replace(/\.jsonl$/, "") };
}
