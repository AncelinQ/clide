import { dirname, join } from "node:path";

import { startServer, type RunningServer } from "@claude-ide/server";
import { BrowserWindow, app, ipcMain, shell } from "electron";

/**
 * Ce module est empaqueté en CommonJS par esbuild : `__dirname` existe, pas
 * `import.meta.url`. Les ressources sont donc résolues depuis le dossier du
 * bundle, qui contient aussi le client et le préchargement.
 */
declare const __dirname: string;

const here = __dirname;

/** Résout un fichier d'une bibliothèque installée, sans dépendre de ses `exports`. */
function packageFile(packageName: string, relativePath: string): string {
  return join(dirname(require.resolve(`${packageName}/package.json`)), relativePath);
}

let server: RunningServer | undefined;
let window_: BrowserWindow | undefined;

/**
 * La fenêtre charge la même URL qu'un navigateur.
 *
 * Une seule implémentation du client, et le mode navigateur reste utilisable
 * sans rien dupliquer. La page garde une origine `http://127.0.0.1`, donc les
 * mêmes règles que partout ailleurs — plutôt qu'un `file://` privilégié.
 */
async function createWindow(): Promise<void> {
  server ??= await startServer({
    webRoot: join(here, "web"),
    vendor: {
      "xterm.js": packageFile("@xterm/xterm", "lib/xterm.js"),
      "xterm.css": packageFile("@xterm/xterm", "css/xterm.css"),
      "addon-fit.js": packageFile("@xterm/addon-fit", "lib/addon-fit.js"),
    },
  });

  window_ = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#16181d",
    title: "claude-ide",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  // Un lien externe part au navigateur : la fenêtre est l'application, pas un
  // navigateur de secours dont on ne saurait plus revenir.
  window_.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  // L'URL sort sur la console : elle permet d'ouvrir la même application dans un
  // navigateur, et de diagnostiquer un démarrage qui n'affiche rien.
  console.log(`claude-ide écoute sur ${server.url}`);

  window_.on("focus", () => window_?.flashFrame(false));
  window_.on("closed", () => {
    window_ = undefined;
  });

  await window_.loadURL(server.url);
}

/**
 * Signale qu'un onglet attend, quand la fenêtre n'est pas au premier plan.
 *
 * `flashFrame` fait clignoter le bouton de la barre des tâches : c'est le seul
 * signal natif qui ne demande pas d'icône à dessiner, et le reprendre en main
 * l'éteint. Une fenêtre déjà regardée n'a rien à réclamer.
 */
ipcMain.on("claude-ide:attention", (_event, waiting: unknown) => {
  if (!window_ || window_.isFocused()) return;
  window_.flashFrame(typeof waiting === "number" && waiting > 0);
});

async function shutdown(): Promise<void> {
  await server?.close();
  server = undefined;
}

void app.whenReady().then(async () => {
  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

// Fermer la fenêtre arrête l'application et, avec elle, les terminaux qu'elle a
// ouverts : les laisser tourner sans interface les rendrait inatteignables.
app.on("window-all-closed", () => {
  void shutdown().then(() => app.quit());
});

app.on("before-quit", () => {
  void shutdown();
});
