import { execFile } from "node:child_process";
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
