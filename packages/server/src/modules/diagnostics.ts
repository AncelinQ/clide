import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";

import {
  findTodos,
  isInside,
  listProjectFiles,
  parseEslint,
  parseTsc,
  samePath,
  type DiagnosticsReport,
  type ToolReport,
} from "@clide/core";

import type { ApiContext } from "../api/routes.js";
import { requireParam } from "../api/routes.js";
import { nodeExecutable } from "../platform/node-path.js";
import type { ServerModule } from "./module.js";

const run = promisify(execFile);

/** Délai avant de vérifier : un enregistrement et la fin de tour de Claude qui le suit ne font qu'une vérification. */
const SETTLE_MS = 1500;
/** Deux projets vérifiés à la fois, au plus : `tsc` tient un cœur et beaucoup de mémoire. */
const CONCURRENCY = 2;
const TOOL_TIMEOUT_MS = 180_000;
const TODO_FILE_LIMIT = 1024 * 1024;
/** Extensions dont les TODO se lisent : du code et du texte, jamais un binaire. */
const TEXT_FILE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|vue|svelte|py|rb|go|rs|java|kt|cs|php|swift|c|h|cpp|hpp|css|scss|less|html|md|mdx|sh|ps1|yml|yaml|toml|sql)$/i;

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Script d'un paquet installé dans `node_modules`, cherché du dossier jusqu'à la racine du projet. */
async function localTool(from: string, root: string, relative: string): Promise<string | undefined> {
  let directory = from;
  for (;;) {
    const candidate = join(directory, "node_modules", relative);
    if (await exists(candidate)) return candidate;
    if (samePath(directory, root) || !isInside(root, directory)) return undefined;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

/**
 * Lance un script Node du projet et rend sa sortie. `tsc` et ESLint sortent en
 * erreur quand ils trouvent quelque chose : leur sortie standard compte quand même.
 */
async function runNode(script: string, args: string[], cwd: string): Promise<string> {
  const node = await nodeExecutable();
  try {
    const { stdout } = await run(node, [script, ...args], { cwd, windowsHide: true, timeout: TOOL_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; message?: string; killed?: boolean };
    if (failed.killed) throw new Error("délai dépassé");
    if (failed.stdout) return failed.stdout;
    throw new Error((failed.stderr || failed.message || "échec").trim().split(/\r?\n/).slice(0, 4).join("\n"));
  }
}

/** Un `tsconfig` qui ne fait que référencer les autres (`"files": []`) ne compile rien lui-même. */
function compiles(text: string): boolean {
  return !(/"files"\s*:\s*\[\s*\]/.test(text) && /"references"\s*:/.test(text));
}

async function checkTsc(root: string, files: string[]): Promise<ToolReport | undefined> {
  const configs = files.filter((path) => basename(path) === "tsconfig.json");
  if (configs.length === 0) return undefined;
  const started = Date.now();
  const diagnostics: ToolReport["diagnostics"] = [];
  const errors: string[] = [];
  let ran = false;
  for (const relative of configs) {
    const config = join(root, relative);
    const text = await readFile(config, "utf8").catch(() => "");
    if (!compiles(text)) continue;
    const tsc = await localTool(dirname(config), root, join("typescript", "bin", "tsc"));
    if (!tsc) continue;
    ran = true;
    try {
      diagnostics.push(...parseTsc(await runNode(tsc, ["--noEmit", "--pretty", "false", "-p", config], dirname(config)), dirname(config)));
    } catch (error) {
      errors.push(`${relative} : ${(error as Error).message}`);
    }
  }
  if (!ran) return undefined;
  return {
    tool: "tsc",
    ranAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    diagnostics,
    ...(errors.length > 0 ? { error: errors.join("\n") } : {}),
  };
}

const ESLINT_CONFIGS = ["eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", "eslint.config.ts", ".eslintrc", ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.json", ".eslintrc.yml", ".eslintrc.yaml"];

async function checkEslint(root: string): Promise<ToolReport | undefined> {
  const configured = (await Promise.all(ESLINT_CONFIGS.map((name) => exists(join(root, name))))).some(Boolean);
  if (!configured) return undefined;
  const eslint = await localTool(root, root, join("eslint", "bin", "eslint.js"));
  if (!eslint) return undefined;
  const started = Date.now();
  const base = { tool: "eslint" as const, ranAt: new Date().toISOString() };
  try {
    const out = await runNode(eslint, ["-f", "json", "."], root);
    return { ...base, durationMs: Date.now() - started, diagnostics: parseEslint(out) };
  } catch (error) {
    // Une configuration qu'ESLint refuse se dit comme telle : zéro erreur ferait croire le projet propre.
    return { ...base, durationMs: Date.now() - started, diagnostics: [], error: (error as Error).message };
  }
}

async function checkTodos(root: string, files: string[]): Promise<ToolReport> {
  const started = Date.now();
  const diagnostics: ToolReport["diagnostics"] = [];
  for (const relative of files) {
    if (!TEXT_FILE.test(relative)) continue;
    const path = join(root, relative);
    try {
      if ((await stat(path)).size > TODO_FILE_LIMIT) continue;
      diagnostics.push(...findTodos(path, await readFile(path, "utf8")));
    } catch {
      // Fichier disparu entre le parcours et la lecture.
    }
  }
  return { tool: "todo", ranAt: new Date().toISOString(), durationMs: Date.now() - started, diagnostics };
}

/** Vérifie un projet : ses outils en parallèle, chacun absent quand le projet ne l'a pas. */
export async function checkProject(root: string): Promise<DiagnosticsReport> {
  const files = await listProjectFiles(root);
  const tools = await Promise.all([checkTsc(root, files), checkEslint(root), checkTodos(root, files)]);
  return { root, tools: tools.filter((tool): tool is ToolReport => tool !== undefined) };
}

/**
 * File des vérifications, une par projet. Une demande qui arrive pendant qu'une
 * vérification tourne ne la double pas : une seule relance suit, à la fin. Une
 * demande attend un court délai, pour regrouper celles qui arrivent ensemble.
 */
export class CheckQueue {
  readonly #reports = new Map<string, DiagnosticsReport>();
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #running = new Set<string>();
  readonly #again = new Set<string>();
  readonly #waiting: string[] = [];

  constructor(
    private readonly check: (root: string) => Promise<DiagnosticsReport> = checkProject,
    private readonly onReport: (report: DiagnosticsReport) => void = () => undefined,
    private readonly settleMs = SETTLE_MS,
    private readonly concurrency = CONCURRENCY,
  ) {}

  report(root: string): DiagnosticsReport | undefined {
    return this.#reports.get(root);
  }

  schedule(root: string): void {
    clearTimeout(this.#timers.get(root));
    this.#timers.set(
      root,
      setTimeout(() => {
        this.#timers.delete(root);
        this.#enqueue(root);
      }, this.settleMs),
    );
  }

  #enqueue(root: string): void {
    if (this.#running.has(root)) {
      this.#again.add(root);
      return;
    }
    if (!this.#waiting.includes(root)) this.#waiting.push(root);
    this.#pump();
  }

  #pump(): void {
    while (this.#running.size < this.concurrency && this.#waiting.length > 0) {
      const root = this.#waiting.shift() as string;
      this.#running.add(root);
      void this.check(root)
        .then((report) => {
          this.#reports.set(root, report);
          this.onReport(report);
        })
        .catch((error: unknown) => console.error("[clide] vérification", root, error))
        .finally(() => {
          this.#running.delete(root);
          if (this.#again.delete(root)) this.#waiting.push(root);
          this.#pump();
        });
    }
  }

  /** Attend que rien ne soit plus en attente ni en cours : pour les tests. */
  async idle(): Promise<void> {
    while (this.#timers.size > 0 || this.#running.size > 0 || this.#waiting.length > 0) {
      await new Promise((done) => setTimeout(done, 20));
    }
  }
}

let queue: CheckQueue | undefined;

/** Projet ouvert qui contient ce chemin, le plus profond d'abord. */
function projectOf(path: string, open: readonly string[]): string | undefined {
  return [...open]
    .filter((root) => samePath(root, path) || isInside(root, path))
    .sort((a, b) => b.length - a.length)[0];
}

/**
 * Erreurs de `tsc` et d'ESLint et TODO du projet, relancés à l'ouverture d'un
 * projet, à chaque fichier écrit par l'API et à chaque fin de tour de Claude.
 */
export const diagnostics: ServerModule = {
  id: "diagnostics",
  start: (context: ApiContext) => {
    queue = new CheckQueue(checkProject, (report) => context.bus.emit("broadcast", { t: "diagnostics", report }));
    const known = new Set<string>();
    context.bus.on("roots", (roots) => {
      for (const root of roots) {
        if (!known.has(root.toLowerCase())) queue?.schedule(root);
      }
      known.clear();
      for (const root of roots) known.add(root.toLowerCase());
    });
    context.bus.on("files", (paths) => {
      const roots = new Set(paths.map((path) => projectOf(path, context.workspace.open)).filter((root): root is string => !!root));
      for (const root of roots) queue?.schedule(root);
    });
    context.notifications.on((notification) => {
      if (notification.kind !== "stop" || !notification.cwd) return;
      const root = projectOf(notification.cwd, context.workspace.open);
      if (root) queue?.schedule(root);
    });
  },
  routes: {
    "/api/diagnostics": async (params) => ({ report: queue?.report(requireParam(params, "root")) ?? null }),
  },
  mutations: {
    "/api/diagnostics/run": async (_params, _context, body) => {
      const root = typeof body["root"] === "string" ? body["root"] : "";
      if (!root) throw new Error("champ `root` manquant");
      queue?.schedule(root);
      return { scheduled: true };
    },
  },
};
