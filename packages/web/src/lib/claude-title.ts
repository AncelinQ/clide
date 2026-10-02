/**
 * Ce que dit le titre que Claude Code donne à son terminal : un glyphe qui tourne
 * (◐ ◑) tant qu'il travaille, ✳ au repos.
 *
 * Au repos couvre deux cas que le titre ne sépare pas : le tour est fini, ou une
 * permission attend une réponse. C'est la notification des hooks qui dit le
 * second. Un autre titre — celui du shell, ou aucun quand Claude Code ne le
 * pose pas — ne dit rien, et l'état connu reste.
 */
export function claudeActivity(title: string): "working" | "idle" | undefined {
  const glyph = title.codePointAt(0);
  if (glyph === undefined) return undefined;
  if (glyph === 0x2733) return "idle";
  // Demi-disques ◐ ◑ ◒ ◓, et les points braille, l'autre spinner courant des terminaux.
  if ((glyph >= 0x25d0 && glyph <= 0x25d3) || (glyph >= 0x2800 && glyph <= 0x28ff)) return "working";
  return undefined;
}
