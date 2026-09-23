import { join } from "node:path";

import { startServer, type RunningServer } from "@claude-ide/server";
import { BrowserWindow, app, ipcMain, nativeImage, shell } from "electron";

/**
 * Ce module est empaqueté en CommonJS par esbuild : `__dirname` existe, pas
 * `import.meta.url`. Les ressources sont donc résolues depuis le dossier du
 * bundle, qui contient aussi le client et le préchargement.
 */
declare const __dirname: string;

const here = __dirname;

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
 * Signale au système les onglets qui attendent.
 *
 * Le compteur incrusté sur le bouton de la barre des tâches reste tant qu'un
 * onglet attend, fenêtre au premier plan ou non : il se lit d'un coup d'œil,
 * comme une pastille. Son image est dessinée par la page, seule à disposer d'un
 * canevas. Le clignotement, lui, ne sert qu'à une fenêtre en arrière-plan, et la
 * reprendre en main l'éteint.
 */
ipcMain.on("claude-ide:attention", (_event, waiting: unknown, badge: unknown) => {
  if (!window_) return;
  const count = typeof waiting === "number" ? waiting : 0;
  if (process.platform === "win32") {
    const image = count > 0 && typeof badge === "string" ? nativeImage.createFromDataURL(badge) : null;
    window_.setOverlayIcon(image, count > 0 ? `${count} onglet(s) en attente` : "");
  }
  if (!window_.isFocused()) window_.flashFrame(count > 0);
});

ipcMain.on("claude-ide:focus", () => {
  if (!window_) return;
  if (window_.isMinimized()) window_.restore();
  window_.show();
  window_.focus();
});

async function shutdown(): Promise<void> {
  await server?.close();
  server = undefined;
}

// Sans identifiant d'application, Windows n'affiche pas les notifications
// d'une application qui n'a pas de raccourci dans le menu Démarrer.
if (process.platform === "win32") app.setAppUserModelId("claude-ide");

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
