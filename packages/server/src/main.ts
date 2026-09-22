import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { startServer } from "./server.js";

const require = createRequire(import.meta.url);

/** Résout un fichier d'une bibliothèque installée, sans dépendre de ses `exports`. */
function packageFile(packageName: string, relativePath: string): string {
  return join(dirname(require.resolve(`${packageName}/package.json`)), relativePath);
}

/**
 * Ouvre l'URL dans le navigateur par défaut.
 *
 * L'URL porte le jeton dans sa requête : `&` est un séparateur de commandes pour
 * `cmd`, d'où les guillemets. Le premier argument vide de `start` est le titre de
 * fenêtre — sans lui, `start` prendrait l'URL pour ce titre.
 */
function openBrowser(url: string): void {
  try {
    const child =
      process.platform === "win32"
        ? spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true })
        : spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], {
            detached: true,
            stdio: "ignore",
          });
    child.unref();
  } catch {
    // Pas de navigateur joignable : l'URL reste affichée sur la sortie standard.
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..", "..", "web");

const server = await startServer({
  webRoot,
  vendor: {
    "xterm.js": packageFile("@xterm/xterm", "lib/xterm.js"),
    "xterm.css": packageFile("@xterm/xterm", "css/xterm.css"),
    "addon-fit.js": packageFile("@xterm/addon-fit", "lib/addon-fit.js"),
  },
  ...(process.env["CLAUDE_IDE_PORT"] ? { port: Number(process.env["CLAUDE_IDE_PORT"]) } : {}),
  // Un jeton fixe sert au développement et aux tests de bout en bout ;
  // sans lui, il est tiré au hasard à chaque démarrage.
  ...(process.env["CLAUDE_IDE_TOKEN"] ? { token: process.env["CLAUDE_IDE_TOKEN"] } : {}),
});

console.log(`claude-ide écoute sur ${server.url}`);

// Le lancement par raccourci n'a pas de terminal où lire l'URL : sans ouverture
// automatique, l'application démarrerait sans que rien n'apparaisse.
if (process.env["CLAUDE_IDE_NO_OPEN"] !== "1") {
  openBrowser(server.url);
  console.log("Navigateur ouvert. CLAUDE_IDE_NO_OPEN=1 pour ne pas l'ouvrir.");
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
