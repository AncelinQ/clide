#!/usr/bin/env node
/**
 * Génère les fixtures de test à partir des transcripts réels de la machine.
 *
 * Les fixtures doivent reproduire la *forme* des events, pas leur contenu : tout
 * texte libre, chemin, URL, adresse et identifiant est remplacé. Les fixtures
 * finissent dans un dépôt, elles ne peuvent donc porter aucune donnée d'entreprise.
 *
 * Usage : node tools/make-fixtures.mjs [--samples 3]
 */
import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "packages", "core", "test", "fixtures");
const CLAUDE_HOME = process.env["CLAUDE_CONFIG_DIR"] || join(homedir(), ".claude");
const PROJECTS = join(CLAUDE_HOME, "projects");

const samplesPerType = Number(
  process.argv.includes("--samples") ? process.argv[process.argv.indexOf("--samples") + 1] : 3,
);

/** Champs dont la valeur est du texte rédigé par l'utilisateur ou le modèle. */
const FREE_TEXT_KEYS = new Set([
  "aiTitle", "lastPrompt", "content", "text", "agentName", "summary",
  "description", "title", "message", "command", "prompt", "atis",
  "hookAdditionalContext", "stopReason",
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;
const WINDOWS_PATH = /^[A-Za-z]:[\\/]/;
const URL_LIKE = /^https?:\/\//;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const BACKUP_NAME = /^[0-9a-f]{16}@v\d+$/i;
const SAFE_TOKEN = /^[a-z0-9][a-z0-9._-]{0,40}$/i;

const uuidPool = new Map();
function fakeUuid(original) {
  if (!uuidPool.has(original)) {
    const n = uuidPool.size + 1;
    const hex = n.toString(16).padStart(12, "0");
    uuidPool.set(original, `00000000-0000-4000-8000-${hex}`);
  }
  return uuidPool.get(original);
}

const pathPool = new Map();
/**
 * Remplace un chemin en conservant sa forme : absolu ou relatif, profondeur,
 * extension. Un `trackingPath` est relatif au projet et doit le rester, sinon la
 * fixture ne teste plus la résolution qu'elle est censée couvrir.
 */
function fakePath(original) {
  if (!pathPool.has(original)) {
    const normalized = original.replace(/\\/g, "/");
    const ext = /\.[a-z0-9]+$/i.exec(normalized)?.[0] ?? "";
    const absolute = WINDOWS_PATH.test(original) || original.startsWith("/");
    const depth = Math.min(normalized.split("/").filter(Boolean).length, 3);
    const dirs = Array.from({ length: Math.max(depth - 1, 1) }, (_, i) => `d${i + 1}`);
    const tail = [...dirs, `fichier${pathPool.size + 1}${ext}`].join("\\");
    pathPool.set(original, absolute ? `C:\\Projets\\projet-a\\${tail}` : tail);
  }
  return pathPool.get(original);
}

function redactString(key, value) {
  if (FREE_TEXT_KEYS.has(key)) return value.length === 0 ? "" : `[texte ${value.length}]`;
  if (UUID.test(value)) return fakeUuid(value);
  if (ISO_DATE.test(value)) return value;
  if (BACKUP_NAME.test(value)) return value.replace(/^[0-9a-f]{16}/i, "0123456789abcdef");
  if (WINDOWS_PATH.test(value) || value.includes("\\") || value.startsWith("/")) return fakePath(value);
  if (URL_LIKE.test(value)) return "https://exemple.invalid/ressource";
  if (EMAIL.test(value)) return "dev@exemple.invalid";
  if (SAFE_TOKEN.test(value)) return value;
  return `[texte ${value.length}]`;
}

function redact(key, value, depth = 0) {
  if (depth > 8) return "[profondeur]";
  if (typeof value === "string") return redactString(key, value);
  if (Array.isArray(value)) return value.slice(0, 3).map((item) => redact(key, item, depth + 1));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redact(k, v, depth + 1);
    return out;
  }
  return value;
}

async function walk(dir, out) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (entry.name.endsWith(".jsonl")) out.push(full);
  }
}

const byType = new Map();
const files = [];
await walk(PROJECTS, files);

if (files.length === 0) {
  console.error(`Aucun transcript sous ${PROJECTS}`);
  process.exit(1);
}

let lines = 0;
let malformed = 0;

for (const file of files) {
  const text = await readFile(file, "utf8");
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    lines += 1;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      malformed += 1;
      continue;
    }
    if (typeof event?.type !== "string") continue;
    const bucket = byType.get(event.type) ?? [];
    if (bucket.length < samplesPerType) {
      bucket.push(redact("", event));
      byType.set(event.type, bucket);
    }
  }
}

await mkdir(OUT_DIR, { recursive: true });

const types = [...byType.keys()].sort();
await writeFile(
  join(OUT_DIR, "events-by-type.json"),
  `${JSON.stringify(Object.fromEntries(types.map((t) => [t, byType.get(t)])), null, 2)}\n`,
  "utf8",
);

// Une session synthétique : un exemplaire de chaque type, dans l'ordre alphabétique.
const session = types.map((t) => JSON.stringify(byType.get(t)[0])).join("\n");
await writeFile(join(OUT_DIR, "session.jsonl"), `${session}\n`, "utf8");

console.log(`transcripts lus : ${files.length}`);
console.log(`lignes          : ${lines} (illisibles : ${malformed})`);
console.log(`types capturés  : ${types.length}`);
console.log(`écrit           : ${relative(process.cwd(), OUT_DIR)}${sep}{events-by-type.json, session.jsonl}`);
