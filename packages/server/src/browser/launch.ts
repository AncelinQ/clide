import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";

/** Port de débogage du navigateur de Claude : fixe, pour que la configuration du MCP reste juste d'un lancement à l'autre. */
export const BROWSER_PORT = 9333;

/** Emplacements usuels de Chrome puis d'Edge sous Windows, du plus au moins probable. */
export function browserCandidates(env: NodeJS.ProcessEnv): string[] {
  const roots = [env["PROGRAMFILES"], env["PROGRAMFILES(X86)"], env["LOCALAPPDATA"]].filter((root): root is string => !!root);
  return [
    ...roots.map((root) => join(root, "Google", "Chrome", "Application", "chrome.exe")),
    ...roots.map((root) => join(root, "Microsoft", "Edge", "Application", "msedge.exe")),
  ];
}

/** Le premier navigateur installé, ou `undefined`. */
export async function findBrowser(env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  for (const candidate of browserCandidates(env)) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Pas là : le suivant.
    }
  }
  return undefined;
}

/**
 * Arguments du navigateur : sans fenêtre (l'aperçu est sa seule vue), un profil
 * à lui dans les données de Clide — jamais celui de l'utilisateur, ses cookies et
 * ses sessions —, et le débogage limité à la boucle locale.
 */
export function browserArgs(port: number, profile: string): string[] {
  return [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1280,800",
    "about:blank",
  ];
}

/** Adresse DevTools du navigateur qui écoute sur `port`, ou `undefined` s'il n'y en a pas. */
export async function browserEndpoint(port: number): Promise<string | undefined> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return undefined;
    const version = (await response.json()) as { webSocketDebuggerUrl?: string };
    return version.webSocketDebuggerUrl;
  } catch {
    return undefined;
  }
}

/** Lance le navigateur et attend qu'il réponde, au plus dix secondes. */
export async function launchBrowser(executable: string, dataDir: string, port = BROWSER_PORT): Promise<{ child: ChildProcess; endpoint: string }> {
  const profile = join(dataDir, "browser", "profile");
  await mkdir(profile, { recursive: true });
  const child = spawn(executable, browserArgs(port, profile), { stdio: "ignore", windowsHide: true });
  const exited = new Promise<never>((_resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`le navigateur s'est arrêté au démarrage (code ${code ?? "?"})`)));
  });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const endpoint = await Promise.race([browserEndpoint(port), exited]);
    if (endpoint) return { child, endpoint };
    await new Promise((done) => setTimeout(done, 250));
  }
  child.kill();
  throw new Error(`le navigateur ne répond pas sur le port ${port}`);
}

export type BrowserMcp = "chrome-devtools" | "playwright";

/** Nom du serveur MCP que Clide déclare : distinct de ceux que l'utilisateur a pu ajouter lui-même. */
export const BROWSER_MCP_NAME = "clide-browser";

/**
 * Configuration du serveur MCP branché sur ce navigateur. Sous Windows, `npx`
 * est un `.cmd` que Claude Code ne lance que par `cmd /c`.
 */
export function browserMcpConfig(kind: BrowserMcp, port = BROWSER_PORT): Record<string, unknown> {
  const url = `http://127.0.0.1:${port}`;
  const args = kind === "chrome-devtools" ? ["chrome-devtools-mcp@latest", "--browserUrl", url] : ["@playwright/mcp@latest", "--cdp-endpoint", url];
  return { type: "stdio", command: "cmd", args: ["/c", "npx", "-y", ...args] };
}
