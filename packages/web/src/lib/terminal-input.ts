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
