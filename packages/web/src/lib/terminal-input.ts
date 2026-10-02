/**
 * Ce que xterm envoie au programme sans que l'utilisateur ait rien tapé : ses
 * réponses aux questions que le programme lui pose. Position du curseur (DSR),
 * attributs du terminal (DA), entrée et sortie du focus, réponses OSC.
 *
 * Elles passent par le même canal que la frappe ; un terminal qui refuse la
 * frappe doit les laisser passer, ou le shell attendrait une réponse qui ne
 * vient pas.
 */
const REPLY = /^\u001b(?:\[\d+;\d+R|\[[?>][\d;]*c|\[[IO]|\][^\u0007\u001b]*(?:\u0007|\u001b\\))$/;

export function isTerminalReply(data: string): boolean {
  return REPLY.test(data);
}

type Keystroke = Pick<KeyboardEvent, "type" | "key" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">;

/**
 * Copier-coller d'un onglet Claude, comme dans un éditeur : Ctrl+V colle le
 * presse-papiers, Ctrl+C copie la sélection du terminal s'il y en a une.
 *
 * Sans sélection, Ctrl+C reste l'interruption de Claude Code ; en rendu
 * fullscreen, Claude Code tient sa propre sélection et la copie lui-même. La
 * lettre est celle que la touche tape : V sous AZERTY comme sous QWERTY.
 */
export function clipboardKey(event: Keystroke, hasSelection: boolean): "copy" | "paste" | undefined {
  if (event.type !== "keydown" || !event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return undefined;
  const key = event.key.toLowerCase();
  if (key === "v") return "paste";
  if (key === "c" && hasSelection) return "copy";
  return undefined;
}
