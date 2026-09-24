import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { startServer } from "./server.js";

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
// Le client est construit par Vite : on sert son `dist`, pas ses sources.
const webRoot = resolve(here, "..", "..", "web", "dist");
// Le guide est construit par VitePress, dans son propre dossier.
const docsRoot = resolve(here, "..", "..", "..", "docs", "guide", ".vitepress", "dist");

const server = await startServer({
  webRoot,
  docsRoot,
  ...(process.env["CLIDE_PORT"] ? { port: Number(process.env["CLIDE_PORT"]) } : {}),
  // Un jeton fixe sert au développement et aux tests de bout en bout ;
  // sans lui, il est tiré au hasard à chaque démarrage.
  ...(process.env["CLIDE_TOKEN"] ? { token: process.env["CLIDE_TOKEN"] } : {}),
});

console.log(`Clide écoute sur ${server.url}`);

// Le lancement par raccourci n'a pas de terminal où lire l'URL : sans ouverture
// automatique, l'application démarrerait sans que rien n'apparaisse.
if (process.env["CLIDE_NO_OPEN"] !== "1") {
  openBrowser(server.url);
  console.log("Navigateur ouvert. CLIDE_NO_OPEN=1 pour ne pas l'ouvrir.");
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
