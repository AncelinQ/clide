import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Les tests de terminal lancent de vrais PowerShell : en parallèle d'autres
    // fichiers, ils affament le processus et font expirer des attentes qui ne
    // sont pas lentes en soi.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
