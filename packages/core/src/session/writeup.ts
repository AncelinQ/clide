/** Ce qu'on peut faire rédiger à partir d'une session. */
export type WriteupKind = "commit" | "mr";

/**
 * Consigne d'un message de commit.
 *
 * Les derniers sujets du dépôt en donnent la convention et la langue : un message
 * rédigé à l'écart de l'historique serait à réécrire. Sans historique, Conventional
 * Commits en anglais.
 */
export function commitInstructions(recentSubjects: string[]): string {
  const history =
    recentSubjects.length > 0
      ? `Recent commit subjects of this repository, newest first — follow their convention (type, scope, tense, language) exactly:\n${recentSubjects.map((subject) => `- ${subject}`).join("\n")}`
      : "The repository has no history yet: use Conventional Commits, in English.";
  return [
    "You receive a Claude Code session: the user's requests, the files it changed and their diffs.",
    "Write the git commit message for these changes.",
    history,
    "Subject line of 72 characters at most. Then a blank line and a body wrapped at 72 columns that says what changed and why, in a few short paragraphs or bullets — not a file-by-file list.",
    "No history of how the session went, no mention of Claude or of the session itself, no trailers.",
    "Answer with the commit message only, nothing before or after, no code fence.",
  ].join("\n\n");
}

/** Consigne d'une description de merge request, dans la langue de l'interface. */
export function mrInstructions(language: "fr" | "en"): string {
  return language === "en"
    ? [
        "You receive a Claude Code session: the user's requests, the files it changed and their diffs.",
        "Write the merge request for these changes, in English Markdown: a first line `# <title>` of 72 characters at most, then the sections `## Why`, `## What changes` (grouped by feature, not by file) and `## How to test` (concrete steps).",
        "Stay factual and short; no mention of Claude or of the session itself.",
        "Answer with the Markdown only, nothing before or after, no code fence around it.",
      ].join("\n\n")
    : [
        "Tu reçois une session de Claude Code : les demandes de l'utilisateur, les fichiers changés et leurs diffs.",
        "Rédige la merge request de ces changements, en Markdown et en français : une première ligne `# <titre>` de 72 caractères au plus, puis les sections `## Pourquoi`, `## Ce qui change` (regroupé par fonctionnalité, pas par fichier) et `## Comment tester` (des étapes concrètes).",
        "Reste factuel et bref ; ne parle ni de Claude ni de la session elle-même.",
        "Réponds uniquement par le Markdown, rien avant ni après, sans bloc de code autour.",
      ].join("\n\n");
}

/** Retire un bloc de code qui envelopperait toute la réponse malgré la consigne. */
export function unfence(answer: string): string {
  const trimmed = answer.trim();
  const fenced = /^```[a-z]*\n([\s\S]*?)\n```$/.exec(trimmed);
  return (fenced?.[1] ?? trimmed).trim();
}
