import type { TerminalInfo } from "../pty/manager.js";
import type { ClaudeNotification } from "./watcher.js";

/** Ce que le routage demande au gestionnaire d'onglets. */
export interface TerminalLookup {
  get(id: string): TerminalInfo | undefined;
  findByCwd(path: string): TerminalInfo | undefined;
}

/**
 * L'onglet visé par un événement de hook.
 *
 * L'onglet que nomme l'événement prime : le nom vient de l'environnement que
 * Clide donne au `claude` de l'onglet, et distingue deux onglets du même
 * dossier. Un `claude` lancé hors de Clide n'en porte pas, et un onglet fermé
 * entre-temps n'existe plus : le dossier de la session rattache alors, comme
 * avant.
 */
export function terminalOf(lookup: TerminalLookup, notification: ClaudeNotification): TerminalInfo | undefined {
  const named = notification.terminalId ? lookup.get(notification.terminalId) : undefined;
  return named ?? (notification.cwd ? lookup.findByCwd(notification.cwd) : undefined);
}
