import { globalTabs } from "@/components/GlobalTabs";
import { t } from "@/i18n";
import { commandFor, focusOf, isUsableShortcut, shortcutOf } from "@/lib/keymap";
import { LIST_KEY } from "@/lib/prompt-keys";
import { openDoc } from "@/lib/api";
import { post, quotePath } from "@/lib/api";
import {
  activateProject,
  activeProject,
  closeProject,
  getState,
  openSettings,
  scriptsShown,
  setBottomMode,
  setState,
  tabsOf,
  updateProject,
} from "@/state/store";
import { tabStops } from "@/lib/script-shelf";
import { groupOf, hiddenTabs } from "@/lib/tab-groups";
import { orderTabs } from "@/lib/tab-order";
import { barOrder, dissolveGroup, newGroupWith, removeTabFromGroup, shiftTabInBar, toggleGroup } from "@/state/groups";
import { toggleScripts } from "@/state/shelf";
import { cycleTheme } from "@/state/theme";
import { closeFile, revealInTree, saveFile, selectedText } from "@/state/editor";
import { focusFileSearch } from "@/components/panels/file-search";
import { openLatestDevServer } from "@/components/DevServers";
import { cachedPrompts, runPrompt } from "@/state/prompts";
import { closeTerminal, focusTerminal, openTerminal, typeAsUser } from "@/state/terminals";

export interface Command {
  id: string;
  label: string;
  group: string;
  /** Raccourci par défaut, au format de `shortcutOf`. */
  shortcut?: string;
  run: () => void;
}

/** Onglets du projet courant, dans leur ordre d'ouverture. */
/** Terminaux du projet actif, dans l'ordre où leurs onglets sont rangés. */
function ownTabs(): string[] {
  const { terminals, activeRoot } = getState();
  const own = Object.values(terminals)
    .filter((entry) => entry.owner === activeRoot)
    .map((entry) => entry.info.id);
  return orderTabs(activeProject()?.tabOrder ?? [], own);
}

/**
 * Terminaux de la barre du projet actif, dans l'ordre où leurs onglets sont rangés,
 * groupes rassemblés. Ceux d'un groupe replié n'en sont pas, sauf celui qu'on
 * regarde : on en repart.
 */
function barTabs(): string[] {
  const current = getState();
  const project = activeProject(current);
  const terminals = new Set(tabsOf(current, current.activeRoot).bar.map((info) => info.id));
  const order = barOrder(current, current.activeRoot);
  const hidden = project ? hiddenTabs(project.tabGroups, order) : new Set<string>();
  return order.filter((id) => terminals.has(id) && (!hidden.has(id) || id === current.activeTerminalId));
}

/** Onglet montré au centre du projet actif, terminal de la barre ou fichier. */
function shownTab(): string | undefined {
  const project = activeProject();
  if (!project || scriptsShown()) return undefined;
  const { activeTerminalId } = getState();
  return project.activeFile ?? (activeTerminalId && barTabs().includes(activeTerminalId) ? activeTerminalId : undefined);
}

/**
 * Décale d'un cran l'onglet montré au centre, terminal ou fichier : il entre dans
 * un groupe ou en sort à son bord. L'onglet Scripts est épinglé : il ne bouge pas,
 * et ses scripts n'ont pas de place dans la barre.
 */
function shiftActiveTab(step: -1 | 1): void {
  const shown = shownTab();
  if (shown) shiftTabInBar(getState().activeRoot, shown, step);
}

function cycle<T>(items: T[], current: T | null | undefined, step: number): T | undefined {
  if (items.length === 0) return undefined;
  const index = current === null || current === undefined ? -1 : items.indexOf(current);
  return items[(index + step + items.length) % items.length];
}

/** Fichier montré au centre du projet actif, s'il y en a un. */
function activeProjectFile(): string | undefined {
  const { projects, activeRoot } = getState();
  return projects.find((project) => project.root === activeRoot)?.activeFile ?? undefined;
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
  const { path } = await post<{ path?: string; cancelled?: boolean }>("/api/capture", {});
  // Annulée dans l'outil ou depuis l'application : rien à insérer.
  if (!path) return;
  typeAsUser(terminalId, `${quotePath(path)} `);
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
  const tabs = globalTabs(getState().disabledModules).map((tab): [string, string] => [tab.id, tab.label]);
  const nextProject = (step: number) => {
    const root = cycle(
      projects.map((project) => project.root),
      activeRoot,
      step,
    );
    if (root) activateProject(root);
  };
  // L'onglet Scripts est un arrêt du parcours, montré sur son script retenu.
  const nextTab = (step: number) => {
    const project = activeProject();
    if (!project) return;
    const opened = tabsOf(getState(), project.root).shelf.map((info) => info.id);
    const stops = tabStops(barTabs(), opened, project.scripts);
    const current = activeTab();
    const id = cycle(stops, current && opened.includes(current) ? stops[0] : current, step);
    if (id) focusTerminal(id);
  };

  return [
    { id: "palette", group: t("Application"), label: t("Palette de commandes"), shortcut: "Ctrl+Shift+P", run: () => openPalette(">") },
    { id: "palette.files", group: t("Application"), label: t("Aller à un fichier du projet"), run: () => openPalette("") },
    { id: "palette.sessions", group: t("Application"), label: t("Aller à une session"), run: () => openPalette("@") },
    { id: "palette.search", group: t("Application"), label: t("Chercher dans les sessions"), run: () => openPalette("#") },
    {
      id: "search.files",
      group: t("Application"),
      label: t("Rechercher dans les fichiers"),
      shortcut: "Ctrl+Shift+F",
      run: () => {
        const project = activeProject();
        if (!project) return;
        // Le texte choisi dans l'éditeur devient la recherche, comme dans VS Code.
        const text = selectedText().split("\n")[0];
        setState({ showLeft: true });
        updateProject(project.root, { leftMode: "search" });
        // La vue se monte au rendu suivant : le focus attend qu'elle soit là.
        setTimeout(() => focusFileSearch(text), 50);
      },
    },
    {
      id: "terminal.focus",
      group: t("Onglets"),
      label: t("Revenir au terminal"),
      run: () => {
        const id = activeTab();
        if (id) focusTerminal(id);
      },
    },
    { id: "preferences", group: t("Application"), label: t("Réglages"), run: () => openSettings() },
    {
      id: "preferences.claude",
      group: t("Application"),
      label: t("Réglages de Claude Code (modèle, interface, permissions…)"),
      run: () => openSettings("claude"),
    },
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
        // Un fichier montré se ferme d'abord ; modifié, il reste ouvert : sa croix demande quoi faire.
        const file = activeProjectFile();
        if (file) {
          closeFile(file);
          return;
        }
        const id = activeTab();
        if (id) closeTerminal(id);
      },
    },
    {
      id: "file.save",
      group: t("Fichiers"),
      label: t("Enregistrer le fichier"),
      run: () => {
        const file = activeProjectFile();
        if (file) void saveFile(file);
      },
    },
    {
      id: "file.reveal",
      group: t("Fichiers"),
      label: t("Montrer le fichier dans l'arborescence"),
      run: () => {
        const file = activeProjectFile();
        if (file) revealInTree(file);
      },
    },
    { id: "tab.scripts", group: t("Onglets"), label: t("Basculer sur les scripts"), shortcut: "Ctrl+Shift+X", run: toggleScripts },
    { id: "tab.next", group: t("Onglets"), label: t("Onglet suivant"), shortcut: "Ctrl+Shift+PageDown", run: () => nextTab(1) },
    { id: "tab.previous", group: t("Onglets"), label: t("Onglet précédent"), shortcut: "Ctrl+Shift+PageUp", run: () => nextTab(-1) },
    { id: "tab.moveLeft", group: t("Onglets"), label: t("Déplacer l'onglet à gauche"), shortcut: "Alt+Shift+PageUp", run: () => shiftActiveTab(-1) },
    { id: "tab.moveRight", group: t("Onglets"), label: t("Déplacer l'onglet à droite"), shortcut: "Alt+Shift+PageDown", run: () => shiftActiveTab(1) },
    // Les groupes, sur l'onglet montré : sans raccourci par défaut, chacun leur en donne un.
    {
      id: "tabGroup.new",
      group: t("Onglets"),
      label: t("Nouveau groupe avec l'onglet"),
      run: () => {
        const shown = shownTab();
        if (shown) newGroupWith(activeRoot, shown);
      },
    },
    {
      id: "tabGroup.fold",
      group: t("Onglets"),
      label: t("Replier ou déplier le groupe de l'onglet"),
      run: () => {
        const shown = shownTab();
        const project = activeProject();
        const group = shown && project ? groupOf(project.tabGroups, shown) : undefined;
        if (group) toggleGroup(activeRoot, group.id);
      },
    },
    {
      id: "tabGroup.leave",
      group: t("Onglets"),
      label: t("Retirer l'onglet de son groupe"),
      run: () => {
        const shown = shownTab();
        if (shown) removeTabFromGroup(activeRoot, shown);
      },
    },
    {
      id: "tabGroup.ungroup",
      group: t("Onglets"),
      label: t("Dégrouper le groupe de l'onglet"),
      run: () => {
        const shown = shownTab();
        const project = activeProject();
        const group = shown && project ? groupOf(project.tabGroups, shown) : undefined;
        if (group) dissolveGroup(activeRoot, group.id);
      },
    },
    {
      id: "tab.capture",
      group: t("Onglets"),
      label: t("Capture d'écran vers le prompt"),
      shortcut: "Ctrl+Shift+S",
      run: () => {
        const id = activeTab();
        if (id) void captureInto(id).catch((error: unknown) => console.error("[clide]", error));
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
        ["captures", "Captures"],
        ["files", "Fichiers"],
        ["diagram", "Schéma"],
        ["writeup", "Rédaction"],
      ] as const
    ).map(([mode, label]) => ({
      id: `session.${mode}`,
      group: t("Session"),
      label: t("Montrer : {label}", { label: t(label) }),
      run: () => {
        setBottomMode(mode);
        setState({ sessionCollapsed: false });
      },
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
    {
      id: "help.docs",
      group: t("Application"),
      label: t("Documentation"),
      shortcut: "Ctrl+Shift+H",
      run: () => openDoc(),
    },
    {
      id: "devserver.open",
      group: t("Application"),
      label: t("Ouvrir le serveur de développement dans le navigateur"),
      shortcut: "Ctrl+Shift+U",
      run: openLatestDevServer,
    },
    { id: "palette.prompts", group: t("Prompts"), label: t("Lancer un prompt enregistré"), shortcut: LIST_KEY, run: () => openPalette("/") },
    // Chaque prompt enregistré est une commande : la palette le trouve, un raccourci peut le lancer.
    // Ceux du projet passent d'abord : sur une même touche, c'est le leur qui part.
    ...cachedPrompts().map((prompt) => ({
      id: `prompt.run:${prompt.id}`,
      group: t("Prompts"),
      label: prompt.label,
      run: () => void runPrompt(prompt),
    })),
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

/** Ouvre la palette sur un préfixe : `>` commandes, `@` sessions, `#` recherche, rien pour les fichiers. */
export function openPalette(prefix: string): void {
  setState({ paletteOpen: true, paletteQuery: prefix });
}

/** Raccourci effectif d'une commande : celui de l'utilisateur, sinon le défaut. */
export function effectiveShortcut(command: Command, overrides: Record<string, string | null>): string | undefined {
  if (command.id in overrides) return overrides[command.id] ?? undefined;
  return command.shortcut;
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
    const { shortcuts, keymap } = getState();
    const all = commands();
    const id = commandFor(shortcut, focusOf(event.target), all, keymap, shortcuts);
    const command = all.find((entry) => entry.id === id);
    if (!command) return;
    event.preventDefault();
    event.stopPropagation();
    command.run();
  };
  window.addEventListener("keydown", onKey, { capture: true });
  return () => window.removeEventListener("keydown", onKey, { capture: true });
}
