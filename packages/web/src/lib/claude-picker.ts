/**
 * Lecture de l'écran de Claude Code quand Clide pilote ses sélecteurs : celui de
 * `/model` et le curseur de `/effort`. Seule leur touche `s` applique un choix à
 * la session sans en faire le défaut des suivantes ; ces fonctions disent où en
 * est l'écran, pour ne jamais valider à l'aveugle.
 *
 * Elles lisent les libellés anglais de Claude Code v2.1.289. Un libellé qui
 * change arrête le geste sans rien changer.
 */

/** Une ligne de l'écran, et pour chaque caractère — par point de code — s'il est estompé. */
export interface ScreenRow {
  text: string;
  dim: boolean[];
}

/** Le sélecteur de `/model` est ouvert. */
export function isModelPicker(lines: readonly string[]): boolean {
  return lines.some((line) => line.includes("s to use this session only"));
}

/**
 * Claude Code demande de confirmer le changement de modèle d'une conversation
 * entamée : le nouveau modèle relira tout l'historique au prochain message. La
 * réponse est à l'utilisateur, qui paie ce coût.
 */
export function isSwitchConfirm(lines: readonly string[]): boolean {
  return lines.some((line) => line.trim() === "Switch model?") && lines.some((line) => /❯\s*1\.\s+Yes, switch to/.test(line));
}

/** Nom du modèle de la ligne surlignée du sélecteur, sans sa coche : `Opus 5.5`. */
export function highlightedModel(lines: readonly string[]): string | undefined {
  for (const line of lines) {
    const match = /^\s*❯\s*\d+\.\s+(.+?)(?:\s{2,}|$)/.exec(line);
    if (match?.[1]) return match[1].replace(/\s*✔\s*$/, "").trim();
  }
  return undefined;
}

/**
 * Le curseur de `/effort` : ses niveaux, de gauche à droite, et l'indice de celui
 * que désigne `▲`, ou rien s'il n'est pas à l'écran.
 */
export function effortSlider(lines: readonly string[]): { levels: string[]; current: number } | undefined {
  if (!lines.some((line) => line.includes("s for this session only"))) return undefined;
  const markerRow = lines.findIndex((line) => line.includes("▲"));
  const scale = lines[markerRow + 1];
  if (markerRow === -1 || scale === undefined) return undefined;
  const marker = [...(lines[markerRow] ?? "")].indexOf("▲");
  const words = [...scale.matchAll(/\S+/g)].map((match) => ({ word: match[0], start: match.index ?? 0 }));
  if (words.length < 2) return undefined;
  // Le repère tombe sous son niveau, ou au plus près de son milieu.
  const distance = (entry: { word: string; start: number }) => {
    const end = entry.start + entry.word.length - 1;
    if (marker >= entry.start && marker <= end) return 0;
    return Math.abs(marker - (entry.start + end) / 2);
  };
  let current = 0;
  words.forEach((entry, index) => {
    if (distance(entry) < distance(words[current] as { word: string; start: number })) current = index;
  });
  return { levels: words.map((entry) => entry.word), current };
}

/**
 * Ce qu'on a commencé à taper sur la ligne de saisie de Claude Code : la ligne qui
 * commence par `❯` juste sous un filet. Les caractères estompés — une suggestion
 * comme `Try "…"` — n'en sont pas. Rien quand la ligne n'est pas à l'écran : une
 * demande de permission ou un menu ouvert la remplace, et y taper y répondrait.
 */
export function inputDraft(rows: readonly ScreenRow[]): string | undefined {
  for (let index = 1; index < rows.length; index++) {
    const row = rows[index] as ScreenRow;
    const above = (rows[index - 1] as ScreenRow).text.trim();
    if (!/^─+$/.test(above)) continue;
    // Par caractère, comme `dim` : une ligne peut porter des caractères hors du plan de base.
    const chars = [...row.text];
    const start = chars.indexOf("❯");
    if (start === -1 || chars.slice(0, start).join("").trim() !== "") continue;
    return chars
      .map((char, at) => (at > start && !row.dim[at] ? char : ""))
      .join("")
      .trim();
  }
  return undefined;
}
