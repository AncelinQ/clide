import { execFile, spawn } from "node:child_process";
import { extname } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

let resolved: Promise<string> | undefined;

/**
 * Exécutable de la CLI Claude, cherché une fois.
 *
 * Seul un `.exe` convient : les écritures passent des valeurs saisies — nom,
 * commande, jetons — et un `.cmd` ne se lance que par `cmd.exe`, qui relirait
 * ces valeurs comme une ligne de commande. L'installation native fournit un
 * `.exe` ; une installation par npm n'offre qu'un `.cmd`, et l'écriture est alors
 * refusée plutôt que confiée au shell.
 */
export function resolveClaude(): Promise<string> {
  resolved ??= run("where.exe", ["claude"], { windowsHide: true })
    .then(({ stdout }) => {
      const candidates = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const exe = candidates.find((path) => extname(path).toLowerCase() === ".exe");
      if (!exe) {
        throw new Error(
          "CLI Claude introuvable en exécutable (.exe) : l'installation native est requise pour écrire ces portées",
        );
      }
      return exe;
    })
    .catch((error: unknown) => {
      resolved = undefined;
      throw error;
    });
  return resolved;
}

export type CliScope = "local" | "user";

/** Arguments de `claude mcp add-json` : la configuration part en un seul JSON, sans drapeau à ordonner. */
export function addJsonArgs(scope: CliScope, name: string, config: Record<string, unknown>): string[] {
  return ["mcp", "add-json", "-s", scope, name, JSON.stringify(config)];
}

export function removeArgs(scope: CliScope, name: string): string[] {
  return ["mcp", "remove", "-s", scope, name];
}

/**
 * Lance `claude mcp …` depuis le dossier du projet — la portée `local` s'attache
 * au dossier courant — et rend sa sortie, ou l'erreur qu'elle a écrite.
 */
export async function runClaudeMcp(args: string[], cwd: string): Promise<string> {
  const executable = await resolveClaude();
  try {
    const { stdout } = await run(executable, args, { cwd, windowsHide: true, timeout: 60_000 });
    return stdout.trim();
  } catch (error) {
    const detail = error as { stderr?: string; stdout?: string; message?: string };
    throw new Error((detail.stderr || detail.stdout || detail.message || "échec de claude mcp").trim());
  }
}

/** Plafond de dépense d'un appel `claude -p`, en dollars : un résumé ne doit rien coûter de plus. */
export const PRINT_BUDGET_USD = 1;

/**
 * Arguments d'un `claude -p` isolé : ni outil, ni serveur MCP, ni réglage — donc
 * ni hook, dont celui des notifications de l'application —, et aucune session
 * enregistrée, qui encombrerait History. La consigne remplace le prompt système.
 */
export function printArgs(instructions: string, model: string): string[] {
  return [
    "-p",
    "--output-format",
    "json",
    "--no-session-persistence",
    "--tools",
    "",
    "--strict-mcp-config",
    "--setting-sources",
    "",
    "--model",
    model,
    "--max-budget-usd",
    String(PRINT_BUDGET_USD),
    "--system-prompt",
    instructions,
  ];
}

export interface PrintResult {
  text: string;
  costUsd?: number;
  model?: string;
}

/** Lit la sortie JSON de `claude -p`, ou dit pourquoi elle n'a rien donné. */
export function parsePrintOutput(stdout: string): PrintResult {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    throw new Error(stdout.trim() || "réponse illisible de claude -p");
  }
  const text = typeof parsed["result"] === "string" ? parsed["result"] : "";
  if (parsed["is_error"] === true || parsed["subtype"] !== "success") {
    throw new Error(text || `claude -p a échoué (${String(parsed["subtype"] ?? "inconnu")})`);
  }
  const cost = parsed["total_cost_usd"];
  const usage = parsed["modelUsage"];
  const model = usage && typeof usage === "object" ? Object.keys(usage)[0] : undefined;
  return { text, ...(typeof cost === "number" ? { costUsd: cost } : {}), ...(model ? { model } : {}) };
}

/**
 * Pose une question à `claude -p` et rend sa réponse.
 *
 * La question passe par l'entrée standard : un résumé de session dépasse la
 * longueur d'une ligne de commande Windows.
 */
export async function runClaudePrint(
  input: string,
  options: { instructions: string; model: string; cwd: string; timeoutMs?: number },
): Promise<PrintResult> {
  const executable = await resolveClaude();
  const child = spawn(executable, printArgs(options.instructions, options.model), {
    cwd: options.cwd,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  const timer = setTimeout(() => child.kill(), options.timeoutMs ?? 180_000);
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
    child.stdin.end(input, "utf8");
  }).finally(() => clearTimeout(timer));
  const out = Buffer.concat(stdout).toString("utf8");
  if (code !== 0 && !out.trim()) {
    throw new Error(Buffer.concat(stderr).toString("utf8").trim() || `claude -p s'est arrêté (code ${String(code)})`);
  }
  return parsePrintOutput(out);
}
