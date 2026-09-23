import { t } from "@/i18n";
import { post, quotePath } from "@/lib/api";
import { closeProject, getState, setState } from "@/state/store";
import { cycleTheme } from "@/state/theme";
import { closeTerminal, focusTerminal, openTerminal, typeInto } from "@/state/terminals";

export interface Command {
  id: string;
  label: string;
  group: string;
  /** Raccourci par défaut, au format de `shortcutOf`. */
  shortcut?: string;
  run: () => void;
}

/** Onglets du projet courant, dans leur ordre d'ouverture. */
function ownTabs(): string[] {
  const { terminals, activeRoot } = getState();
  return Object.values(terminals)
    .filter((entry) => entry.owner === activeRoot)
    .map((entry) => entry.info.id);
}

function cycle<T>(items: T[], current: T | null | undefined, step: number): T | undefined {
  if (items.length === 0) return undefined;
  const index = current === null || current === undefined ? -1 : items.indexOf(current);
  return items[(index + step + items.length) % items.length];
}

function activeTab(): string | undefined {
  const { activeTerminalId } = getState();
  return activeTerminalId && ownTabs().includes(activeTerminalId) ? activeTerminalId : undefined;
}

/**
 * Capture d'une zone de l'écran, dont le chemin est tapé dans l'onglet actif.
 * Partagée par le bouton de la barre d'onglets et la commande.
 */
export async function captureInto(terminalId: string): Promise<void> {
  const { path } = await post<{ path: string }>("/api/capture", {});
  typeInto(terminalId, `${quotePath(path)} `);
  focusTerminal(terminalId);
}

/**
 * Toutes les actions atteignables au clavier.
 *
 * Les raccourcis par défaut sont choisis pour ne rien voler au terminal :
 * `Ctrl+Maj` sur des lettres que ni PowerShell ni Claude Code n'utilisent ainsi —
 * jamais C ni V, qui copient et collent —, et jamais `Ctrl+Alt`, qui est AltGr sur
 * un clavier français et sert à taper `€`, `[` ou `@`. `Ctrl+Tab` n'est pas
 * interceptable dans un navigateur : la navigation passe par Page préc./suiv.
 */
export function commands(): Command[] {
  const { projects, activeRoot, globalTab } = getState();
  const tabs: [string, string][] = [
    ["processes", "Process"],
    ["history", "History"],
    ["skills", "Skills"],
    ["mcp", "MCP"],
    ["settings", "Réglages"],
    ["notifications", "Alertes"],
  ];
  const nextProject = (step: number) => {
    const root = cycle(
      projects.map((project) => project.root),
      activeRoot,
      step,
    );
    if (root) setState({ activeRoot: root });
  };
  const nextTab = (step: number) => {
    const id = cycle(ownTabs(), activeTab(), step);
    if (id) focusTerminal(id);
  };

  return [
    { id: "palette", group: t("Application"), label: t("Palette de commandes"), shortcut: "Ctrl+Shift+P", run: () => setState({ paletteOpen: true }) },
    { id: "preferences", group: t("Application"), label: t("Préférences"), run: () => setState({ preferencesOpen: true }) },
    { id: "theme", group: t("Application"), label: t("Changer de thème"), run: cycleTheme },

    { id: "project.open", group: t("Projets"), label: t("Ouvrir un projet"), shortcut: "Ctrl+Shift+O", run: () => setState({ addingProject: true }) },
    {
      id: "project.close",
      group: t("Projets"),
      label: t("Fermer le projet"),
      run: () => {
        if (!activeRoot) return;
        for (const id of ownTabs()) closeTerminal(id);
        closeProject(activeRoot);
      },
    },
    { id: "project.next", group: t("Projets"), label: t("Projet suivant"), shortcut: "Alt+PageDown", run: () => nextProject(1) },
    { id: "project.previous", group: t("Projets"), label: t("Projet précédent"), shortcut: "Alt+PageUp", run: () => nextProject(-1) },

    { id: "tab.shell", group: t("Onglets"), label: t("Nouveau shell"), shortcut: "Ctrl+Shift+T", run: () => openTerminal("shell") },
    {
      id: "tab.claude",
      group: t("Onglets"),
      label: t("Nouvel onglet Claude"),
      shortcut: "Ctrl+Shift+A",
      run: () => openTerminal("claude", { command: "claude" }),
    },
    {
      id: "tab.close",
      group: t("Onglets"),
      label: t("Fermer l'onglet"),
      shortcut: "Ctrl+Shift+W",
      run: () => {
        const id = activeTab();
        if (id) closeTerminal(id);
      },
    },
    { id: "tab.next", group: t("Onglets"), label: t("Onglet suivant"), shortcut: "Ctrl+Shift+PageDown", run: () => nextTab(1) },
    { id: "tab.previous", group: t("Onglets"), label: t("Onglet précédent"), shortcut: "Ctrl+Shift+PageUp", run: () => nextTab(-1) },
    {
      id: "tab.capture",
      group: t("Onglets"),
      label: t("Capture d'écran vers le prompt"),
      shortcut: "Ctrl+Shift+S",
      run: () => {
        const id = activeTab();
        if (id) void captureInto(id).catch((error: unknown) => console.error("[claude-ide]", error));
      },
    },

    {
      id: "session.toggle",
      group: t("Session"),
      label: t("Replier ou déplier le bloc session"),
      shortcut: "Ctrl+Shift+J",
      run: () => setState((current) => ({ sessionCollapsed: !current.sessionCollapsed })),
    },
    ...(
      [
        ["plan", "Plan"],
        ["activity", "Activité"],
        ["files", "Fichiers"],
      ] as const
    ).map(([mode, label]) => ({
      id: `session.${mode}`,
      group: t("Session"),
      label: t("Montrer : {label}", { label: t(label) }),
      run: () => setState({ sessionMode: mode, sessionCollapsed: false }),
    })),

    {
      id: "view.left",
      group: t("Affichage"),
      label: t("Colonne du projet"),
      shortcut: "Ctrl+Shift+B",
      run: () => setState((current) => ({ showLeft: !current.showLeft })),
    },
    {
      id: "view.right",
      group: t("Affichage"),
      label: t("Panneau global"),
      shortcut: "Ctrl+Shift+E",
      run: () => setState((current) => ({ showRight: !current.showRight })),
    },
    ...tabs.map(([id, label]) => ({
      id: `panel.${id}`,
      group: t("Affichage"),
      label:
        id === globalTab
          ? t("Panneau global : {label} (ouvert)", { label: t(label) })
          : t("Panneau global : {label}", { label: t(label) }),
      run: () => setState({ showRight: true, globalTab: id }),
    })),
  ];
}

/** Raccourci effectif d'une commande : celui de l'utilisateur, sinon le défaut. */
export function effectiveShortcut(command: Command, overrides: Record<string, string | null>): string | undefined {
  if (command.id in overrides) return overrides[command.id] ?? undefined;
  return command.shortcut;
}

const MODIFIERS = new Set(["Control", "Shift", "Alt", "Meta", "AltGraph"]);

/**
 * Nom d'une combinaison, ou rien pour une touche de modificateur seule.
 *
 * La lettre vient de `key`, pas de la position physique : sur un clavier AZERTY,
 * `Ctrl+Maj+A` est la touche marquée A. Une combinaison avec AltGr ne donne rien,
 * c'est un caractère à taper.
 */
export function shortcutOf(event: KeyboardEvent): string | undefined {
  if (MODIFIERS.has(event.key) || event.getModifierState?.("AltGraph")) return undefined;
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  return [event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift", key].filter(Boolean).join("+");
}

/** Une combinaison qui ne porte ni Ctrl ni Alt se tape : elle ne peut pas servir de raccourci. */
export function isUsableShortcut(shortcut: string): boolean {
  return /^(Ctrl|Alt)\+/.test(shortcut);
}

/**
 * Écoute le clavier pour toute l'application.
 *
 * En phase de capture, sur la fenêtre : la touche est prise avant d'atteindre
 * xterm, qui l'enverrait au shell. Une combinaison qui n'est à aucune commande
 * passe telle quelle — tout ce qui n'est pas explicitement un raccourci reste au
 * terminal.
 */
export function listenShortcuts(): () => void {
  const onKey = (event: KeyboardEvent) => {
    // Pendant qu'on enregistre un nouveau raccourci, la touche est pour l'éditeur.
    if (document.body.dataset["recordingShortcut"] === "true") return;
    const shortcut = shortcutOf(event);
    if (!shortcut || !isUsableShortcut(shortcut)) return;
    const { shortcuts } = getState();
    const command = commands().find((entry) => effectiveShortcut(entry, shortcuts) === shortcut);
    if (!command) return;
    event.preventDefault();
    event.stopPropagation();
    command.run();
  };
  window.addEventListener("keydown", onKey, { capture: true });
  return () => window.removeEventListener("keydown", onKey, { capture: true });
}
