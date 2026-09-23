import type { ClaudeNotification, NotificationKind } from "@/lib/types";
import { getState } from "@/state/store";

const TITLES: Record<NotificationKind, string> = {
  permission: "Claude demande une autorisation",
  idle: "Claude attend une réponse",
  stop: "Claude a terminé",
  other: "Claude",
};

/**
 * Affiche une notification système pour un événement de hook.
 *
 * Seulement quand la fenêtre n'a pas le focus : devant l'application, la pastille
 * d'onglet suffit, et une notification par fin de réponse serait du bruit.
 * L'étiquette est celle de l'onglet, pour qu'une nouvelle alerte remplace la
 * précédente au lieu de s'empiler. Le clic ramène la fenêtre et l'onglet visé.
 */
export function notifySystem(
  notification: ClaudeNotification,
  terminalId: string | undefined,
  focus: (terminalId: string) => void,
): void {
  if (document.hasFocus()) return;
  if (!window.Notification || Notification.permission !== "granted") return;

  const entry = terminalId ? getState().terminals[terminalId] : undefined;
  const where = entry ? getState().projects.find((project) => project.root === entry.owner)?.name : undefined;
  const body = [where, notification.message].filter(Boolean).join(" — ");

  const shown = new Notification(TITLES[notification.kind], {
    body,
    ...(terminalId ? { tag: terminalId } : {}),
  });
  shown.onclick = () => {
    // Sous Electron, `window.focus()` ne ramène pas une fenêtre réduite : il faut
    // le processus principal.
    if (window.claudeIde) window.claudeIde.focusWindow();
    else window.focus();
    if (terminalId && getState().terminals[terminalId]) focus(terminalId);
    shown.close();
  };
}
