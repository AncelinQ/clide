import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { TerminalInfo, TerminalKind } from "./manager.js";

/** Terminal tel qu'il rouvre au lancement suivant, avec le même identifiant. */
export interface SavedTerminal {
  id: string;
  openedAs: TerminalKind;
  kind: TerminalKind;
  projectRoot: string;
  cwd: string;
  owner?: string;
  label?: string;
  name?: string;
  script?: string;
  /** Session Claude attachée à la fermeture : l'onglet la reprend. */
  sessionId?: string;
  /** Commande qui tournait dans le shell, retapée sans être lancée. */
  command?: string;
}

/** Ce qu'il faut écrire d'un terminal ouvert. */
export interface TerminalSnapshot {
  saved: SavedTerminal;
  /** Sortie du terminal, telle qu'elle est partie vers le client. */
  scrollback: string;
}

export interface LoadedTerminal {
  saved: SavedTerminal;
  /** Sortie gardée, vide pour un terminal qui ne rejoue rien. */
  scrollback: string;
}

/**
 * Ce qu'un terminal ouvert laisse au lancement suivant.
 *
 * La commande en cours n'est gardée que pour un shell : un onglet de script se
 * relance par son bouton, et `claude` est repris par sa session.
 */
export function savedTerminalOf(
  info: TerminalInfo,
  extra: { label?: string; name?: string; command?: string; sessionId?: string } = {},
): SavedTerminal {
  const keepCommand = info.kind === "shell" && !info.script && !extra.sessionId;
  return {
    id: info.id,
    openedAs: info.openedAs,
    kind: info.kind,
    projectRoot: info.projectRoot,
    cwd: info.cwd,
    ...(info.owner ? { owner: info.owner } : {}),
    ...(extra.label ? { label: extra.label } : {}),
    ...(extra.name ? { name: extra.name } : {}),
    ...(info.script ? { script: info.script } : {}),
    ...(extra.sessionId ? { sessionId: extra.sessionId } : {}),
    ...(keepCommand && extra.command ? { command: extra.command } : {}),
  };
}

/** Le terminal rejoue sa sortie : un shell, pas une session Claude que `--resume` redessine. */
export function replays(saved: SavedTerminal): boolean {
  return saved.kind === "shell" && !saved.sessionId;
}

const ESC = "\u001b";
const SGR = /\u001b\[[0-9;:]*m/g;

/**
 * Remet le terminal dans un état neutre après une sortie qui a pu s'arrêter au
 * milieu d'un programme plein écran : écran principal, curseur visible, souris et
 * collage entre crochets coupés.
 */
const RESET_MODES = `${ESC}[?1049l${ESC}[?25h${ESC}[?1000l${ESC}[?1002l${ESC}[?1003l${ESC}[?1006l${ESC}[?2004l`;

const GREY = `${ESC}[90m`;
const PLAIN = `${ESC}[0m`;

/**
 * Sortie d'avant la fermeture, telle qu'un shell rouvert la rejoue : en gris,
 * sans ses couleurs, suivie d'un séparateur. Une sortie vide ne rejoue rien.
 */
export function replayOf(scrollback: string): string {
  if (!scrollback) return "";
  const text = scrollback.replace(SGR, "");
  return `${GREY}${text}${RESET_MODES}${PLAIN}\r\n${GREY}── session restaurée ──${PLAIN}\r\n`;
}

/**
 * Les identifiants deviennent des noms de fichiers : seul un UUID est accepté,
 * pour qu'un `terminals.json` modifié à la main n'écrive ni ne lise hors du
 * dossier.
 */
export function isTerminalId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

const KINDS: readonly unknown[] = ["shell", "claude"] satisfies TerminalKind[];
const OPTIONAL_FIELDS = ["owner", "label", "name", "script", "sessionId", "command"] as const;

function parseSaved(value: unknown): SavedTerminal | undefined {
  if (!value || typeof value !== "object") return undefined;
  const entry = value as Record<string, unknown>;
  if (!isTerminalId(entry.id)) return undefined;
  if (!KINDS.includes(entry.openedAs) || !KINDS.includes(entry.kind)) return undefined;
  if (typeof entry.projectRoot !== "string" || !entry.projectRoot) return undefined;
  const saved: SavedTerminal = {
    id: entry.id,
    openedAs: entry.openedAs as TerminalKind,
    kind: entry.kind as TerminalKind,
    projectRoot: entry.projectRoot,
    cwd: typeof entry.cwd === "string" && entry.cwd ? entry.cwd : entry.projectRoot,
  };
  for (const field of OPTIONAL_FIELDS) {
    const text = entry[field];
    if (typeof text === "string" && text) saved[field] = text;
  }
  return saved;
}

const VERSION = 1;

export interface SnapshotDelays {
  /** Attente entre un changement et l'écriture de la liste. */
  list: number;
  /** Intervalle d'écriture des sorties qui ont changé. */
  scrollback: number;
}

/**
 * Terminaux ouverts, gardés d'un lancement du serveur à l'autre.
 *
 * `terminals.json` tient la liste, `scrollback/<id>.txt` la sortie de chaque
 * shell. La liste est écrite peu après chaque changement, les sorties à
 * intervalle régulier quand elles ont changé, et tout l'est à l'arrêt.
 *
 * `flushSync` écrit de façon synchrone puis gèle les écritures : à l'arrêt, les
 * terminaux sont tués ensuite, et leur sortie ou leur fin ne doit plus rien
 * changer à ce qui a été écrit.
 */
export class TerminalSnapshots {
  readonly #file: string;
  readonly #dir: string;
  #enabled = true;
  #stopped = false;
  #listTimer: NodeJS.Timeout | undefined;
  #scrollbackTimer: NodeJS.Timeout | undefined;
  /** Dernière sortie écrite par terminal : rien à réécrire tant qu'elle n'a pas changé. */
  readonly #written = new Map<string, string>();
  /** Écritures mises bout à bout : deux enregistrements rapprochés ne se croisent pas. */
  #saving: Promise<void> = Promise.resolve();

  constructor(
    dataDir: string,
    private readonly current: () => TerminalSnapshot[],
    private readonly delays: SnapshotDelays = { list: 1000, scrollback: 30_000 },
  ) {
    this.#file = join(dataDir, "terminals.json");
    this.#dir = join(dataDir, "scrollback");
  }

  /** Terminaux gardés au dernier arrêt ; un fichier absent ou illisible n'en donne aucun. */
  async load(): Promise<LoadedTerminal[]> {
    if (!this.#enabled) return [];
    let entries: unknown;
    try {
      const parsed: unknown = JSON.parse(await readFile(this.#file, "utf8"));
      entries = (parsed as { terminals?: unknown } | null)?.terminals;
    } catch {
      return [];
    }
    if (!Array.isArray(entries)) return [];

    const seen = new Set<string>();
    const out: LoadedTerminal[] = [];
    for (const entry of entries) {
      const saved = parseSaved(entry);
      if (!saved || seen.has(saved.id)) continue;
      seen.add(saved.id);
      let scrollback = "";
      if (replays(saved)) {
        scrollback = await readFile(this.#scrollbackFile(saved.id), "utf8").catch(() => "");
        if (scrollback) this.#written.set(saved.id, scrollback);
      }
      out.push({ saved, scrollback });
    }
    return out;
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  /** Désactivé, plus rien n'est écrit et ce qui l'a été est effacé. */
  set enabled(value: boolean) {
    if (value === this.#enabled) return;
    this.#enabled = value;
    if (value) {
      this.start();
      this.schedule();
      return;
    }
    this.#clearTimers();
    this.#written.clear();
    this.#saving = this.#saving.then(() => this.#erase()).catch(() => {
      // Fichier tenu par un autre programme : il reste, mais n'est plus ni lu ni réécrit.
    });
  }

  /** Lance l'écriture régulière des sorties. */
  start(): void {
    if (!this.#writing || this.#scrollbackTimer) return;
    this.#scrollbackTimer = setInterval(() => this.#queue(false), this.delays.scrollback);
    this.#scrollbackTimer.unref();
  }

  /**
   * La liste a changé : elle sera écrite sous peu. Le délai court depuis le
   * premier changement, pour qu'un flot de changements ne repousse pas
   * l'écriture indéfiniment.
   */
  schedule(): void {
    if (!this.#writing || this.#listTimer) return;
    this.#listTimer = setTimeout(() => {
      this.#listTimer = undefined;
      this.#queue(true);
    }, this.delays.list);
    this.#listTimer.unref();
  }

  /** Attend la fin des écritures en cours. */
  flush(): Promise<void> {
    return this.#saving;
  }

  /** Écrit tout tout de suite, puis n'écrit plus rien. */
  flushSync(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#clearTimers();
    if (!this.#enabled) return;
    const snapshots = this.current();
    try {
      mkdirSync(this.#dir, { recursive: true });
      for (const { saved, scrollback } of this.#changedScrollbacks(snapshots)) {
        writeAtomicSync(this.#scrollbackFile(saved.id), scrollback);
        this.#written.set(saved.id, scrollback);
      }
      writeAtomicSync(this.#file, listOf(snapshots));
      for (const name of readdirSync(this.#dir)) {
        if (keeps(snapshots, name)) continue;
        // Une écriture asynchrone peut tenir encore un fichier temporaire ouvert.
        rmSync(join(this.#dir, name), { force: true, maxRetries: 2 });
      }
    } catch {
      // Dossier de données en lecture seule : les terminaux ne rouvriront pas.
    }
  }

  #queue(withList: boolean): void {
    this.#saving = this.#saving.then(() => this.#write(withList)).catch(() => {
      // Dossier de données en lecture seule : les terminaux ne rouvriront pas.
    });
  }

  /** Écrit la liste, ou les sorties qui ont changé, puis retire les sorties de trop. */
  async #write(withList: boolean): Promise<void> {
    if (!this.#writing) return;
    const snapshots = this.current();
    const changed = withList ? [] : this.#changedScrollbacks(snapshots);
    if (!withList && changed.length === 0) return;

    await mkdir(this.#dir, { recursive: true });
    if (withList) await this.#writeAtomic(this.#file, listOf(snapshots));
    for (const { saved, scrollback } of changed) {
      if (!(await this.#writeAtomic(this.#scrollbackFile(saved.id), scrollback))) return;
      this.#written.set(saved.id, scrollback);
    }
    for (const name of await readdir(this.#dir)) {
      if (!this.#writing) return;
      if (keeps(snapshots, name)) continue;
      await rm(join(this.#dir, name), { force: true });
      if (name.endsWith(".txt")) this.#written.delete(name.slice(0, -".txt".length));
    }
  }

  /** Ni gelé à l'arrêt ni désactivé. */
  get #writing(): boolean {
    return this.#enabled && !this.#stopped;
  }

  /**
   * Écrit à côté puis renomme : une coupure en pleine écriture ne perd pas tout.
   * Le renommage n'a pas lieu si l'écriture a été gelée ou désactivée entre-temps,
   * pour ne pas remplacer ce que `flushSync` vient d'écrire. Rend `false` alors.
   */
  async #writeAtomic(file: string, text: string): Promise<boolean> {
    await writeFile(`${file}.tmp`, text, "utf8");
    if (!this.#writing) {
      await rm(`${file}.tmp`, { force: true });
      return false;
    }
    await rename(`${file}.tmp`, file);
    return true;
  }

  /** Sorties qui diffèrent de ce qui est sur le disque. */
  #changedScrollbacks(snapshots: readonly TerminalSnapshot[]): TerminalSnapshot[] {
    return snapshots.filter(
      ({ saved, scrollback }) =>
        replays(saved) && isTerminalId(saved.id) && scrollback !== "" && this.#written.get(saved.id) !== scrollback,
    );
  }

  #scrollbackFile(id: string): string {
    return join(this.#dir, `${id}.txt`);
  }

  async #erase(): Promise<void> {
    await rm(this.#file, { force: true });
    await rm(this.#dir, { recursive: true, force: true, maxRetries: 3 });
  }

  #clearTimers(): void {
    clearTimeout(this.#listTimer);
    clearInterval(this.#scrollbackTimer);
    this.#listTimer = undefined;
    this.#scrollbackTimer = undefined;
  }
}

/** Un fichier du dossier des sorties est celui d'un terminal gardé qui rejoue. */
function keeps(snapshots: readonly TerminalSnapshot[], name: string): boolean {
  return snapshots.some(({ saved }) => replays(saved) && name === `${saved.id}.txt`);
}

function listOf(snapshots: readonly TerminalSnapshot[]): string {
  const terminals = snapshots.map(({ saved }) => saved).filter((saved) => isTerminalId(saved.id));
  return JSON.stringify({ version: VERSION, terminals }, null, 2);
}

/** Version synchrone de l'écriture à côté puis renommée, pour l'arrêt. */
function writeAtomicSync(file: string, text: string): void {
  // Un autre nom que l'écriture asynchrone, qui peut être en cours au même moment.
  writeFileSync(`${file}.sync.tmp`, text, "utf8");
  renameSync(`${file}.sync.tmp`, file);
}
