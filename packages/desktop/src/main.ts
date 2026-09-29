import { join } from "node:path";

import { startServer, type RunningServer } from "@clide/server";
import { BrowserWindow, app, dialog, ipcMain, nativeImage, shell } from "electron";

import { Updater } from "./updater";

/**
 * Ce module est empaqueté en CommonJS par esbuild : `__dirname` existe, pas
 * `import.meta.url`. Les ressources sont donc résolues depuis le dossier du
 * bundle, qui contient aussi le client et le préchargement.
 */
declare const __dirname: string;

const here = __dirname;

let server: RunningServer | undefined;
let window_: BrowserWindow | undefined;

const updater = new Updater((state) => window_?.webContents.send("clide:update", state));

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
    docsRoot: join(here, "docs"),
  });

  window_ = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#16181d",
    title: "Clide",
    // L'exécutable empaqueté porte déjà l'icône ; `electron .` en développement, non.
    icon: join(here, "icon.png"),
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
  console.log(`Clide écoute sur ${server.url}`);

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
ipcMain.on("clide:attention", (_event, waiting: unknown, badge: unknown) => {
  if (!window_) return;
  const count = typeof waiting === "number" ? waiting : 0;
  if (process.platform === "win32") {
    const image = count > 0 && typeof badge === "string" ? nativeImage.createFromDataURL(badge) : null;
    window_.setOverlayIcon(image, count > 0 ? `${count} onglet(s) en attente` : "");
  }
  if (!window_.isFocused()) window_.flashFrame(count > 0);
});

ipcMain.on("clide:focus", () => {
  if (!window_) return;
  if (window_.isMinimized()) window_.restore();
  window_.show();
  window_.focus();
});

/**
 * Sélecteur natif de dossier ou de fichier, modal à la fenêtre. Rend `undefined`
 * sur une annulation.
 */
ipcMain.handle("clide:pick", async (_event, request: unknown) => {
  const { kind, title, start, extensions } = (request ?? {}) as Record<string, unknown>;
  const file = kind === "file";
  const filters = Array.isArray(extensions)
    ? extensions.filter((extension): extension is string => typeof extension === "string")
    : [];
  const options: Electron.OpenDialogOptions = {
    properties: [file ? "openFile" : "openDirectory"],
    ...(typeof title === "string" && title ? { title } : {}),
    ...(typeof start === "string" && start ? { defaultPath: start } : {}),
    ...(file && filters.length
      ? { filters: [{ name: filters.map((extension) => `.${extension}`).join(", "), extensions: filters }] }
      : {}),
  };
  const result = window_ ? await dialog.showOpenDialog(window_, options) : await dialog.showOpenDialog(options);
  return result.canceled ? undefined : result.filePaths[0];
});

ipcMain.handle("clide:update:get", () => updater.get());
ipcMain.handle("clide:update:check", () => updater.check());
ipcMain.on("clide:update:install", () => updater.install());
ipcMain.on("clide:update:auto", (_event, enabled: unknown) => updater.setAuto(enabled !== false));

async function shutdown(): Promise<void> {
  updater.stop();
  await server?.close();
  server = undefined;
}

// Sans identifiant d'application, Windows n'affiche pas les notifications
// d'une application qui n'a pas de raccourci dans le menu Démarrer.
if (process.platform === "win32") app.setAppUserModelId("fr.clide.app");

void app.whenReady().then(async () => {
  await createWindow();
  updater.start();
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
