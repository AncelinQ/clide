import "@xterm/xterm/css/xterm.css";
import "@/index.css";
import { hydrateSavedState } from "@/state/saved";

/**
 * Démarre la page une fois l'état mémorisé relu chez le serveur.
 *
 * Le store se construit à l'import, depuis `localStorage` : tout ce qui le tire
 * est donc chargé après la relecture, sans quoi il partirait d'une mémoire vide
 * et l'application rouvrirait sans ses projets.
 */
async function boot(): Promise<void> {
  await hydrateSavedState();
  const [{ StrictMode }, { createRoot }, { App }, { applyTheme, watchSystemTheme }, { connect }] = await Promise.all([
    import("react"),
    import("react-dom/client"),
    import("@/App"),
    import("@/state/theme"),
    import("@/state/terminals"),
  ]);

  applyTheme();
  watchSystemTheme();
  connect();

  createRoot(document.querySelector("#root") as HTMLElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
