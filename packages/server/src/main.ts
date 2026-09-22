import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { startServer } from "./server.js";

const require = createRequire(import.meta.url);

/** Résout un fichier d'une bibliothèque installée, sans dépendre de ses `exports`. */
function packageFile(packageName: string, relativePath: string): string {
  return join(dirname(require.resolve(`${packageName}/package.json`)), relativePath);
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

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
