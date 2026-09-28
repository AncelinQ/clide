import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Seuls les modules purs du client sont testés ici : ni DOM, ni store.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
