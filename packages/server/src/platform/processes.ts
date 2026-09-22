import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface RawProcess {
  pid: number;
  parentPid: number;
  name: string;
  commandLine?: string;
  startedAt?: string;
  memoryMB: number;
}

/**
 * - `owned`    : terminal ouvert par l'application, son identifiant est connu.
 * - `inferred` : processus Claude lancé ailleurs, rattaché par recoupement.
 * - `orphan`   : rien ne permet de le rattacher.
 */
export type ProcessLink =
  | { kind: "owned"; terminalId: string }
  | { kind: "inferred"; confidence: number }
  | { kind: "orphan" };

export interface ProcessNode extends RawProcess {
  link: ProcessLink;
  children: ProcessNode[];
}

const SCRIPT = [
  "Get-CimInstance Win32_Process |",
  "Select-Object ProcessId,ParentProcessId,Name,CommandLine,",
  "@{n='StartedAt';e={$_.CreationDate.ToString('o')}},",
  "@{n='MemoryMB';e={[math]::Round($_.WorkingSetSize/1MB,1)}} |",
  "ConvertTo-Json -Compress -Depth 2",
].join(" ");

function toRaw(row: Record<string, unknown>): RawProcess | undefined {
  const pid = row["ProcessId"];
  const parentPid = row["ParentProcessId"];
  const name = row["Name"];
  if (typeof pid !== "number" || typeof name !== "string") return undefined;
  const commandLine = row["CommandLine"];
  const startedAt = row["StartedAt"];
  const memory = row["MemoryMB"];
  return {
    pid,
    parentPid: typeof parentPid === "number" ? parentPid : 0,
    name,
    ...(typeof commandLine === "string" ? { commandLine } : {}),
    ...(typeof startedAt === "string" ? { startedAt } : {}),
    memoryMB: typeof memory === "number" ? memory : 0,
  };
}

export function parseProcessList(json: string): RawProcess[] {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return [];
  }
  // `ConvertTo-Json` rend un objet seul plutôt qu'un tableau d'un élément.
  const rows = Array.isArray(value) ? value : [value];
  const out: RawProcess[] = [];
  for (const row of rows) {
    if (row && typeof row === "object") {
      const raw = toRaw(row as Record<string, unknown>);
      if (raw) out.push(raw);
    }
  }
  return out;
}

/** Vrai pour un processus Claude Code, quel que soit son emballage. */
export function isClaudeProcess(process: RawProcess): boolean {
  if (process.name.toLowerCase() === "claude.exe") return true;
  const command = process.commandLine?.toLowerCase() ?? "";
  return process.name.toLowerCase() === "node.exe" && /[\\/]claude(\.js)?["\s]/.test(command);
}

/**
 * Construit l'arbre des processus Claude et de leurs enfants.
 *
 * Windows ne donne pas le répertoire de travail d'un processus tiers : un
 * processus lancé hors de l'application ne peut pas être rattaché avec certitude
 * à une session. Les terminaux que nous avons ouverts, eux, sont connus par leur
 * identifiant — d'où deux qualités de lien, que l'affichage doit distinguer
 * plutôt que de laisser croire à une certitude uniforme.
 */
export function buildProcessTree(
  processes: readonly RawProcess[],
  ownedPids: ReadonlyMap<number, string>,
): ProcessNode[] {
  const byPid = new Map(processes.map((process) => [process.pid, process]));
  const childrenOf = new Map<number, RawProcess[]>();
  for (const process of processes) {
    const siblings = childrenOf.get(process.parentPid) ?? [];
    siblings.push(process);
    childrenOf.set(process.parentPid, siblings);
  }

  /** Remonte la chaîne des parents jusqu'à un terminal que nous avons ouvert. */
  const ownerOf = (process: RawProcess): string | undefined => {
    const seen = new Set<number>();
    let current: RawProcess | undefined = process;
    while (current && !seen.has(current.pid)) {
      seen.add(current.pid);
      const owner = ownedPids.get(current.pid);
      if (owner) return owner;
      current = byPid.get(current.parentPid);
    }
    return undefined;
  };

  const attach = (process: RawProcess, depth: number): ProcessNode => {
    const terminalId = ownerOf(process);
    const link: ProcessLink = terminalId
      ? { kind: "owned", terminalId }
      : isClaudeProcess(process)
        ? { kind: "inferred", confidence: 0.5 }
        : { kind: "orphan" };

    return {
      ...process,
      link,
      // La profondeur est bornée : une chaîne circulaire de parents ne doit pas
      // faire tourner la construction indéfiniment.
      children: depth > 6 ? [] : (childrenOf.get(process.pid) ?? []).map((child) => attach(child, depth + 1)),
    };
  };

  // Racines : les processus Claude dont le parent n'en est pas un. Un parent
  // absent de l'inventaire — déjà terminé — fait de l'enfant une racine.
  const isRoot = (process: RawProcess): boolean => {
    const parent = byPid.get(process.parentPid);
    return !parent || !isClaudeProcess(parent);
  };

  return processes
    .filter(isClaudeProcess)
    .filter(isRoot)
    .map((process) => attach(process, 0))
    .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
}

export function flatten(nodes: readonly ProcessNode[]): ProcessNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

/**
 * Inventaire des processus de la machine.
 *
 * L'appel coûte environ une seconde pour six cents processus : il est mis en
 * cache brièvement, pour qu'un panneau rafraîchi deux fois de suite ne le paie
 * pas deux fois, sans pour autant montrer un état périmé.
 */
export class ProcessLister {
  #cache: { at: number; processes: RawProcess[] } | undefined;

  constructor(private readonly cacheMs = 2000) {}

  async list(): Promise<RawProcess[]> {
    if (this.#cache && Date.now() - this.#cache.at < this.cacheMs) return this.#cache.processes;
    if (process.platform !== "win32") return [];
    try {
      const { stdout } = await run("powershell.exe", ["-NoProfile", "-Command", SCRIPT], {
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
      });
      const processes = parseProcessList(stdout);
      this.#cache = { at: Date.now(), processes };
      return processes;
    } catch {
      return [];
    }
  }

  async tree(ownedPids: ReadonlyMap<number, string>): Promise<ProcessNode[]> {
    return buildProcessTree(await this.list(), ownedPids);
  }

  /**
   * Arrête un processus, à condition qu'il figure dans l'arbre Claude.
   *
   * Cette garde n'est pas une formalité : l'interface est servie en HTTP local,
   * et une route capable de tuer un identifiant arbitraire tuerait aussi bien
   * une session de travail que le gestionnaire de fenêtres.
   */
  async stop(pid: number, ownedPids: ReadonlyMap<number, string>): Promise<boolean> {
    const allowed = new Set(flatten(await this.tree(ownedPids)).map((node) => node.pid));
    if (!allowed.has(pid)) return false;
    try {
      process.kill(pid);
      this.#cache = undefined;
      return true;
    } catch {
      return false;
    }
  }
}
