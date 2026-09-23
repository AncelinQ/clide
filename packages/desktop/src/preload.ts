import { contextBridge, ipcRenderer, webUtils } from "electron";

/**
 * Pont entre la page et l'application de bureau.
 *
 * Tout passe par `contextBridge` : la page reste sans accès à Node, exactement
 * comme dans un navigateur. N'y sont exposées que les capacités qui
 * justifiaient l'emballage.
 */
contextBridge.exposeInMainWorld("claudeIde", {
  desktop: true,

  /**
   * Chemin disque d'un fichier déposé.
   *
   * C'est la seule chose qu'un navigateur ne sait pas faire : il livre le
   * contenu d'un fichier déposé, jamais son chemin. Or déposer un fichier du
   * projet pour en écrire le chemin dans le prompt est le geste utile.
   */
  pathForFile(file: File): string | undefined {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return undefined;
    }
  },

  /** Signale au système qu'un onglet attend une réponse. */
  setAttention(waiting: number): void {
    ipcRenderer.send("claude-ide:attention", waiting);
  },

  /** Ramène la fenêtre au premier plan, même réduite. */
  focusWindow(): void {
    ipcRenderer.send("claude-ide:focus");
  },
});
