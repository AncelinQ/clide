import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Un prompt enregistré : un texte qu'on envoie souvent à Claude (`/sc:brainstorm`,
 * une consigne récurrente), à portée d'un clic, d'une palette ou d'un raccourci.
 */
export interface SavedPrompt {
  id: string;
  label: string;
  /** Texte envoyé ; peut porter des variables : `{sélection}`, `{fichier}`, `{branche}`, `{saisie}`. */
  text: string;
  /** `insert` tape le texte sans valider, pour le compléter ; `send` l'envoie. */
  mode: "insert" | "send";
  /** `user` : ceux de l'utilisateur, partout ; `project` : ceux du projet, versionnables avec lui. */
  scope: "user" | "project";
}

interface PromptFile {
  version: 1;
  prompts: Omit<SavedPrompt, "scope">[];
}

/** Fichier des prompts d'un projet, à côté de sa configuration Claude Code. */
export function projectPromptsFile(root: string): string {
  return join(root, ".claude", "clide-prompts.json");
}

function valid(value: unknown): value is Omit<SavedPrompt, "scope"> {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item["id"] === "string" &&
    typeof item["label"] === "string" &&
    typeof item["text"] === "string" &&
    (item["mode"] === "insert" || item["mode"] === "send")
  );
}

/**
 * Lit un fichier de prompts. Absent, il est vide ; une entrée illisible est
 * écartée sans perdre les autres. Un fichier qui n'est pas du JSON refuse la
 * lecture : l'écrire ensuite effacerait ce que l'utilisateur y a mis à la main.
 */
async function readFileOf(path: string): Promise<Omit<SavedPrompt, "scope">[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return [];
  }
  const parsed = JSON.parse(raw) as Partial<PromptFile>;
  return Array.isArray(parsed.prompts) ? parsed.prompts.filter(valid) : [];
}

async function writeFileOf(path: string, prompts: Omit<SavedPrompt, "scope">[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const body: PromptFile = { version: 1, prompts };
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

export class PromptStore {
  /** `userFile` : les prompts de l'utilisateur, dans le dossier de données de l'application. */
  constructor(private readonly userFile: string) {}

  #fileOf(scope: SavedPrompt["scope"], root?: string): string {
    if (scope === "user") return this.userFile;
    if (!root) throw new Error("un prompt de projet demande son projet");
    return projectPromptsFile(root);
  }

  /** Ceux du projet d'abord, puis ceux de l'utilisateur. */
  async list(root?: string): Promise<SavedPrompt[]> {
    const project = root ? (await readFileOf(projectPromptsFile(root))).map((item) => ({ ...item, scope: "project" as const })) : [];
    const user = (await readFileOf(this.userFile)).map((item) => ({ ...item, scope: "user" as const }));
    return [...project, ...user];
  }

  /** Ajoute un prompt, ou remplace celui qui porte son `id` ; un prompt sans `id` en reçoit un. */
  async save(prompt: Omit<SavedPrompt, "id"> & { id?: string }, root?: string): Promise<SavedPrompt> {
    const label = prompt.label.trim();
    const text = prompt.text.trim();
    if (!label) throw new Error("le prompt n'a pas de nom");
    if (!text) throw new Error("le prompt est vide");
    const file = this.#fileOf(prompt.scope, root);
    const current = await readFileOf(file);
    const saved = { id: prompt.id ?? randomUUID(), label, text, mode: prompt.mode };
    const index = current.findIndex((item) => item.id === saved.id);
    const next = index === -1 ? [...current, saved] : current.map((item, at) => (at === index ? saved : item));
    await writeFileOf(file, next);
    return { ...saved, scope: prompt.scope };
  }

  async remove(id: string, scope: SavedPrompt["scope"], root?: string): Promise<void> {
    const file = this.#fileOf(scope, root);
    const current = await readFileOf(file);
    await writeFileOf(
      file,
      current.filter((item) => item.id !== id),
    );
  }
}

/** Nom d'une commande `/…` dans le texte qu'en garde le transcript, ou rien. */
export function slashCommandOf(text: string): string | undefined {
  return /<command-name>\s*(\/[^\s<]+)\s*<\/command-name>/.exec(text)?.[1];
}

/**
 * Commandes les plus tapées, de la plus fréquente à la moins fréquente : de
 * quoi proposer d'enregistrer celles qu'on retape sans cesse.
 */
export function topCommands(
  entries: Iterable<{ text: string; at?: string }>,
  options: { since?: number; minimum?: number; limit?: number; exclude?: Set<string> } = {},
): { command: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (options.since && entry.at && Date.parse(entry.at) < options.since) continue;
    const command = slashCommandOf(entry.text);
    if (!command || options.exclude?.has(command)) continue;
    counts.set(command, (counts.get(command) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= (options.minimum ?? 3))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, options.limit ?? 8)
    .map(([command, count]) => ({ command, count }));
}
