import type { ClaudeNotification, NotificationKind } from "@/lib/types";
import { getState } from "@/state/store";

const TITLES: Record<NotificationKind, string> = {
  permission: "Claude demande une autorisation",
  idle: "Claude attend une réponse",
  stop: "Claude a terminé",
  resume: "Claude reprend",
  other: "Claude",
};

/** Notification encore affichée, par onglet. */
const shownFor = new Map<string, Notification>();

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
  if (terminalId) {
    shownFor.get(terminalId)?.close();
    shownFor.set(terminalId, shown);
    shown.onclose = () => {
      if (shownFor.get(terminalId) === shown) shownFor.delete(terminalId);
    };
  }
}

/** Retire la notification d'un onglet qui n'attend plus rien. */
export function dismissSystem(terminalId: string): void {
  shownFor.get(terminalId)?.close();
  shownFor.delete(terminalId);
}

/**
 * Dessine le compteur incrusté sur l'icône de la barre des tâches.
 *
 * Rouge fixe plutôt qu'une couleur du thème : il se pose sur la barre des tâches,
 * dont le fond ne suit pas l'application. Au-delà de 9, le chiffre ne tiendrait
 * pas dans seize pixels.
 */
export function badgeImage(count: number): string {
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return "";
  context.fillStyle = "#d93a2b";
  context.beginPath();
  context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#ffffff";
  context.font = "bold 20px 'Segoe UI', sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(count > 9 ? "9+" : String(count), size / 2, size / 2 + 1);
  return canvas.toDataURL("image/png");
}
