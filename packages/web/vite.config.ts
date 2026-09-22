import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    // Le serveur sert ce dossier tel quel ; l'application de bureau le recopie.
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
});
