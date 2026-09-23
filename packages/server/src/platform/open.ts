import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { extname } from "node:path";

/**
 * Extensions que Windows exécute au lieu de les ouvrir.
 *
 * Leur association par défaut lance un interpréteur : `.js` part chez Windows
 * Script Host, pas dans un éditeur. Un double-clic dans l'arborescence d'un dépôt
 * ne doit rien exécuter ; ces fichiers sont montrés dans l'Explorateur à la place.
 */
const RUNNABLE = new Set([
  ".exe", ".com", ".bat", ".cmd", ".msi", ".msc", ".cpl", ".scr", ".pif",
  ".ps1", ".psm1", ".psd1", ".vbs", ".vbe", ".js", ".jse", ".wsf", ".wsh",
  ".hta", ".jar", ".reg", ".lnk", ".url", ".appref-ms", ".application",
]);

export function isRunnable(path: string): boolean {
  return RUNNABLE.has(extname(path).toLowerCase());
}

/** Ce que l'ouverture a fait réellement, pour le dire à l'utilisateur. */
export type OpenOutcome = "opened" | "revealed";

/**
 * Ouvre un fichier avec l'application par défaut, ou le montre dans l'Explorateur.
 *
 * `explorer.exe` plutôt que `cmd /c start` : aucun shell ne relit le chemin, et un
 * `&` dans un nom de fichier ne devient pas une seconde commande. L'Explorateur
 * sort en code 1 même quand il réussit ; son code de sortie ne dit rien.
 */
export async function openPath(path: string, reveal = false): Promise<OpenOutcome> {
  const info = await stat(path);
  const revealing = reveal || (info.isFile() && isRunnable(path));
  const args = revealing ? [`/select,"${path}"`] : [`"${path}"`];
  const child = spawn("explorer.exe", args, {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
    // Les guillemets sont posés ici : laisser Node citer l'argument entier
    // donnerait `"/select,C:\…"`, que l'Explorateur ne comprend pas.
    windowsVerbatimArguments: true,
  });
  child.unref();
  return revealing ? "revealed" : "opened";
}
