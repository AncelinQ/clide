import type { FileDiff } from "../files/history.js";

/**
 * Taille du résumé envoyé à `claude -p`, en caractères : une quinzaine de milliers
 * de tokens au plus. Une longue session touche des centaines de fichiers ; le
 * schéma n'a besoin que de leur forme, pas de chaque ligne.
 */
export const DIGEST_MAX = 60_000;

/** Part du résumé laissée aux demandes, le reste allant aux diffs. */
const PROMPTS_SHARE = 0.2;
/** Une demande au-delà est coupée : c'est son intention qui compte, pas son détail. */
const PROMPT_MAX = 600;

export interface SessionDigest {
  text: string;
  /** Des demandes ou des diffs ont été coupés pour tenir dans le budget. */
  truncated: boolean;
}

function cut(text: string, max: number): { text: string; cut: boolean } {
  return text.length <= max ? { text, cut: false } : { text: `${text.slice(0, max)}\n[… coupé]`, cut: true };
}

/**
 * Ce que `claude -p` lit pour dessiner la session : ses demandes, la liste des
 * fichiers changés, puis leurs diffs, chacun réduit à sa part du budget pour
 * qu'un gros fichier n'efface pas les autres.
 */
export function sessionDigest(
  input: { title?: string; prompts: string[]; diffs: FileDiff[] },
  max = DIGEST_MAX,
): SessionDigest {
  let truncated = false;
  const parts: string[] = [];
  if (input.title) parts.push(`# Session\n${input.title}`);

  const promptBudget = Math.floor(max * PROMPTS_SHARE);
  const prompts: string[] = [];
  let used = 0;
  for (const [index, prompt] of input.prompts.entries()) {
    const line = `${index + 1}. ${cut(prompt.replace(/\s+/g, " ").trim(), PROMPT_MAX).text}`;
    if (used + line.length > promptBudget) {
      truncated = true;
      break;
    }
    if (line.includes("[… coupé]")) truncated = true;
    prompts.push(line);
    used += line.length;
  }
  if (prompts.length > 0) parts.push(`# Demandes\n${prompts.join("\n")}`);

  const changed = input.diffs.filter((diff) => diff.unified.length > 0 || diff.created || diff.deleted);
  if (changed.length > 0) {
    parts.push(
      `# Fichiers changés\n${changed
        .map((diff) => {
          const state = diff.created ? " (créé)" : diff.deleted ? " (supprimé)" : "";
          return `- ${diff.trackingPath}${state} +${diff.linesAdded} -${diff.linesRemoved}`;
        })
        .join("\n")}`,
    );
  }

  const readable = changed.filter((diff) => !diff.binary && diff.unified.length > 0);
  let remaining = max - parts.join("\n\n").length;
  const diffs: string[] = [];
  for (const [position, diff] of readable.entries()) {
    const share = Math.floor(remaining / (readable.length - position));
    if (share < 200) {
      truncated = true;
      break;
    }
    const piece = cut(diff.unified, share);
    if (piece.cut) truncated = true;
    diffs.push(piece.text);
    remaining -= piece.text.length;
  }
  if (diffs.length > 0) parts.push(`# Diffs\n${diffs.join("\n")}`);

  return { text: parts.join("\n\n"), truncated };
}

/** Consigne donnée à `claude -p`, dans la langue de l'interface. */
export function diagramInstructions(language: "fr" | "en"): string {
  return language === "en"
    ? [
        "You receive a Claude Code session: the user's requests, the files it changed and their diffs.",
        "Draw one Mermaid diagram showing what the session changed and how the changes connect (data flow, calls, dependencies).",
        "Each node names a change, not a file: \"route /api/session/diagram\", \"Diagram tab\", \"digest capped at 60k chars\". Several files serving the same change make one node.",
        "Use a flowchart (LR or TD), 25 nodes at most, labels of a few English words, no paths; group by feature or package with subgraphs.",
        "Answer with the ```mermaid block only, nothing before or after.",
      ].join("\n")
    : [
        "Tu reçois une session de Claude Code : les demandes de l'utilisateur, les fichiers changés et leurs diffs.",
        "Dessine un seul diagramme Mermaid qui montre ce que la session a changé et comment ces changements s'articulent (flux de données, appels, dépendances).",
        "Chaque nœud nomme un changement, pas un fichier : « route /api/session/diagram », « onglet Schéma », « résumé plafonné à 60 000 caractères ». Plusieurs fichiers au service du même changement font un seul nœud.",
        "Un flowchart (LR ou TD), 25 nœuds au plus, des libellés de quelques mots en français, sans chemins ; regroupe par fonctionnalité ou par paquet avec des subgraph.",
        "Réponds uniquement par le bloc ```mermaid, rien avant ni après.",
      ].join("\n");
}

const DIAGRAM_START = /^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|mindmap)\b/;

/** Source Mermaid d'une réponse : son bloc ```mermaid, ou la réponse entière si elle en est une. */
export function extractMermaid(answer: string): string | undefined {
  const fenced = /```mermaid[^\n]*\n([\s\S]*?)```/.exec(answer)?.[1]?.trim();
  if (fenced) return fenced;
  const bare = answer.trim();
  return DIAGRAM_START.test(bare) ? bare : undefined;
}
