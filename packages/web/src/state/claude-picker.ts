/**
 * Change le modèle ou l'effort d'un onglet Claude pour sa session seule.
 *
 * `/model <id>` et `/effort <niveau>` font du choix le défaut des sessions
 * suivantes ; seule la touche `s` de leurs sélecteurs le garde à la session. Clide
 * pilote donc le sélecteur comme on le ferait au clavier, et lit l'écran entre
 * chaque touche (`lib/claude-picker.ts`). Un écran qui ne répond pas comme prévu
 * referme le sélecteur et le dit : Entrée n'y est jamais envoyée, et `s` ne part
 * que sur la ligne voulue.
 */

import { t } from "@/i18n";
import { effortSlider, highlightedModel, inputDraft, isModelPicker, isSwitchConfirm } from "@/lib/claude-picker";
import type { ModelChoice } from "@/lib/models";
import { getState, setState, subscribe } from "@/state/store";
import { focusTerminal, screenRows, typeInto } from "@/state/terminals";

const KEY = { home: "\x1b[H", down: "\x1b[B", right: "\x1b[C", left: "\x1b[D", escape: "\x1b" };

/** Délai laissé à Claude Code pour montrer ce qu'une touche doit faire paraître. */
const STEP_TIMEOUT_MS = 3000;
const POLL_MS = 40;
/** Lignes parcourues au plus dans le sélecteur de modèle ; il en compte une douzaine, et boucle. */
const MAX_ROWS = 40;
/** Durée d'un avis d'échec en bas du terminal. */
const NOTICE_MS = 6000;

/** Onglets où un geste est en cours : un second attendrait l'écran du premier. */
const running = new Set<string>();
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

/** Un avis en bas du terminal ; sans durée, il reste jusqu'au suivant. */
function notice(id: string, text: string | null, lasts?: number): void {
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = undefined;
  setState((state) =>
    text ? { terminalNotice: { id, text } } : state.terminalNotice?.id === id ? { terminalNotice: null } : {},
  );
  if (text && lasts) noticeTimer = setTimeout(() => notice(id, null), lasts);
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const lines = (id: string): string[] => (screenRows(id) ?? []).map((row) => row.text);

/** Attend que `read` trouve ce qu'il cherche à l'écran, ou rend `undefined` passé le délai. */
async function waitFor<T>(id: string, read: (lines: string[]) => T | undefined, timeout = STEP_TIMEOUT_MS): Promise<T | undefined> {
  const started = Date.now();
  for (;;) {
    const found = read(lines(id));
    if (found !== undefined) return found;
    if (Date.now() - started > timeout) return undefined;
    await delay(POLL_MS);
  }
}

/** L'onglet est un onglet Claude vivant. */
function isClaude(id: string): boolean {
  const info = getState().terminals[id]?.info;
  return info !== undefined && !info.exited && info.kind === "claude";
}

/** Attend la fin du tour de Claude ; faux si l'onglet ferme ou cesse d'être un onglet Claude. */
function idle(id: string): Promise<boolean> {
  return new Promise((resolve) => {
    let stop = () => {};
    const check = () => {
      if (!isClaude(id)) {
        stop();
        resolve(false);
      } else if (!getState().claudeBusy[id]) {
        stop();
        resolve(true);
      }
    };
    stop = subscribe(check);
    check();
  });
}

/** Tape une commande dans la ligne de saisie, puis Entrée à part : reçue avec le texte, elle serait un saut de ligne collé. */
async function command(id: string, text: string): Promise<void> {
  typeInto(id, text);
  await delay(150);
  typeInto(id, "\r");
}

class Abort extends Error {}

/**
 * Le geste commun : un à la fois par onglet, après la fin du tour de Claude, sur
 * une ligne de saisie visible et vide. `body` lève `Abort` pour s'arrêter ; le
 * sélecteur est alors refermé et l'avis dit pourquoi.
 */
async function drive(id: string, body: () => Promise<void>): Promise<void> {
  if (running.has(id) || !isClaude(id)) return;
  running.add(id);
  try {
    if (getState().claudeBusy[id]) {
      notice(id, t("Le changement attend la fin du tour de Claude."));
      if (!(await idle(id))) return notice(id, null);
    }
    if (getState().attention[id] === "permission") throw new Abort(t("Claude attend ta réponse : réponds-lui d'abord."));
    const draft = inputDraft(screenRows(id) ?? []);
    if (draft === undefined) throw new Abort(t("La ligne de saisie de Claude n'est pas à l'écran : ferme ce qui y est ouvert, puis recommence."));
    if (draft) throw new Abort(t("La ligne de saisie de Claude n'est pas vide : envoie ou efface ce qui y est écrit, puis recommence."));
    await body();
    notice(id, null);
  } catch (error) {
    if (!(error instanceof Abort)) throw error;
    notice(id, error.message, NOTICE_MS);
  } finally {
    running.delete(id);
  }
}

/** Referme le sélecteur ouvert et arrête le geste. */
function giveUp(id: string, reason: string): never {
  typeInto(id, KEY.escape);
  throw new Abort(t("{reason} Rien n'a changé.", { reason }));
}

/** Passe l'onglet `id` sur `model`, pour sa session seule. */
export function switchModel(id: string, model: ModelChoice): Promise<void> {
  return drive(id, async () => {
    await command(id, "/model");
    const opened = await waitFor(id, (screen) => (isModelPicker(screen) ? highlightedModel(screen) : undefined));
    if (!opened) giveUp(id, t("Le sélecteur de modèle de Claude Code ne s'est pas ouvert."));
    let shown = opened;
    if (shown !== model.name) {
      typeInto(id, KEY.home);
      await delay(120);
      shown = (await waitFor(id, highlightedModel)) ?? shown;
      const first = shown;
      for (let row = 0; row < MAX_ROWS && shown !== model.name; row++) {
        const before = shown;
        typeInto(id, KEY.down);
        const next = await waitFor(id, (screen) => {
          const label = highlightedModel(screen);
          return label !== undefined && label !== before ? label : undefined;
        });
        // Revenu en tête sans l'avoir croisé : le sélecteur ne le propose pas.
        if (!next || next === first) giveUp(id, t("Le sélecteur de Claude Code ne propose pas {name}.", { name: model.name }));
        shown = next;
      }
    }
    if (shown !== model.name) giveUp(id, t("Le sélecteur de Claude Code ne propose pas {name}.", { name: model.name }));
    typeInto(id, "s");
    if (!(await waitFor(id, (screen) => (isModelPicker(screen) ? undefined : true)))) {
      giveUp(id, t("Le sélecteur de modèle de Claude Code ne s'est pas refermé."));
    }
    // La confirmation d'une conversation entamée prend la place du sélecteur, à
    // l'écran suivant : c'est à l'utilisateur d'y répondre, qui en paie le coût.
    await delay(250);
    if (isSwitchConfirm(lines(id))) {
      focusTerminal(id);
      throw new Abort(t("Claude Code demande de confirmer : le nouveau modèle relira toute la conversation au prochain message. Réponds dans le terminal."));
    }
  });
}

/** Règle l'effort de l'onglet `id` sur `level`, pour sa session seule. */
export function switchEffort(id: string, level: string): Promise<void> {
  return drive(id, async () => {
    await command(id, "/effort");
    const slider = await waitFor(id, effortSlider);
    if (!slider) giveUp(id, t("Le curseur d'effort de Claude Code ne s'est pas ouvert."));
    const target = slider.levels.indexOf(level);
    if (target === -1) giveUp(id, t("Le curseur d'effort de Claude Code ne propose pas {level}.", { level }));
    const key = target > slider.current ? KEY.right : KEY.left;
    for (let at = slider.current; at !== target; at += target > at ? 1 : -1) {
      const expected = at + (target > at ? 1 : -1);
      typeInto(id, key);
      if (!(await waitFor(id, (screen) => (effortSlider(screen)?.current === expected ? true : undefined)))) {
        giveUp(id, t("Le curseur d'effort de Claude Code n'a pas bougé comme prévu."));
      }
    }
    typeInto(id, "s");
    if (!(await waitFor(id, (screen) => (effortSlider(screen) ? undefined : true)))) {
      giveUp(id, t("Le curseur d'effort de Claude Code ne s'est pas refermé."));
    }
  });
}
