import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

/**
 * Le serveur et le cœur sont regroupés dans un seul fichier.
 *
 * Un bundle évite d'embarquer l'arbre `node_modules` d'un espace de travail pnpm,
 * dont les liens symboliques ne survivent pas à l'empaquetage. Restent dehors ce
 * qui ne peut pas être groupé : `electron`, fourni par le runtime, et `node-pty`,
 * qui charge un binaire natif.
 */
await build({
  entryPoints: [join(here, "src", "main.ts")],
  outfile: join(dist, "main.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron", "node-pty"],
  // La version ESM d'abord : certaines bibliothèques publient un UMD dont la
  // fabrique appelle `require` dynamiquement, ce qu'un regroupement statique ne
  // peut pas suivre — le module manquant n'apparaît alors qu'au lancement.
  mainFields: ["module", "main"],
  sourcemap: true,
  logLevel: "info",
});

// Le préchargement est chargé par Chromium, pas par Node : il lui faut son
// propre bundle, et `electron` reste fourni par le runtime.
await build({
  entryPoints: [join(here, "src", "preload.ts")],
  outfile: join(dist, "preload.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  sourcemap: true,
  logLevel: "info",
});

// Le client est servi depuis le dossier du bundle, à côté de lui.
await cp(join(here, "..", "web", "dist"), join(dist, "web"), { recursive: true });

console.log("empaqueté dans", dist);
