import {
  Activity,
  CircleAlert,
  ClipboardList,
  Crosshair,
  FileDiff,
  FolderOpen,
  Images,
  PenLine,
  Sparkles,
  Terminal as TerminalIcon,
  Workflow,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { Island } from "@/components/columns";
import { useDevServers } from "@/components/DevServers";
import { Splitter, clamp } from "@/components/Splitter";
import { ModeBlock, type Mode } from "@/components/ModeBlock";
import { ContextArea } from "@/components/Menu";
import { EditorPane } from "@/components/EditorPane";
import { moduleBottomViews } from "@/modules";
import { FileIcon } from "@/components/FileIcon";
import { ScriptsList, ScriptsTab } from "@/components/ScriptsShelf";
import { ClaudeToolbar, NewTabMenu, ScriptToolbar, tabItems } from "@/components/TerminalMenus";
import { TerminalFind } from "@/components/TerminalFind";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { baseName } from "@/lib/fs";
import { barMove, holderOf } from "@/lib/bar-keys";
import { NO_GROUPS, barEntries, barItems, dropInBar, gather, type BarEntry } from "@/lib/tab-groups";
import { orderTabs } from "@/lib/tab-order";
import { ReorderItem, useReorder } from "@/components/Reorderable";
import {
  CloseGroupDialog,
  GROUP_STYLE,
  GroupLabel,
  contentsOf,
  closeGroup,
  tabGroupItems,
  TAB_FOCUS,
  type TabProps,
} from "@/components/TabGroups";
import { renameSession } from "@/state/claude-picker";
import { dropOnBar } from "@/state/groups";
import { closeFile, isDiff, isTranscript, revealInTree, saveFile, showFile, showTerminals } from "@/state/editor";
import { formatSessionCost } from "@/components/panels/costs";
import { CapturesPanel } from "@/components/panels/captures";
import { DiagramPanel } from "@/components/panels/diagram";
import { WriteupPanel } from "@/components/panels/writeup";
import { ActivityPanel, FilesPanel, PlanPanel, formatTokens, type ShownSession } from "@/components/panels/session";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import { t } from "@/i18n";
import { placementOf, splitTabs } from "@/lib/script-shelf";
import { IMAGE_PASTE, quotePath } from "@/lib/terminal-input";
import {
  DEFAULT_WIDTHS,
  activeProject,
  bottomModeOf,
  getState,
  openProject,
  scriptsShown,
  selectedSessionOf,
  sessionTabOf,
  setBottomMode,
  setState,
  updateProject,
  useStore,
} from "@/state/store";
import { terminalTheme } from "@/state/theme";
import {
  closeTerminal,
  focusTerminal,
  mount,
  openTerminal,
  renameTerminal,
  resize,
  resizeActive,
  typeAsUser,
} from "@/state/terminals";
import { PATHS_MIME, api, saveImage } from "@/lib/api";
import { recentProjects } from "@/lib/recents";
import { NameInput, useAsync } from "@/components/common";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { NotificationKind, SessionSummary, TerminalInfo } from "@/lib/types";

/** Hauteur que le terminal garde quand on agrandit l'îlot du bas. */
const TERMINAL_MIN_HEIGHT = 160;

/** Accueil affiché tant qu'aucun terminal n'est ouvert pour ce projet. */
/**
 * Sans projet ouvert : les projets où des sessions ont tourné, avec leur nombre
 * de sessions, à rouvrir d'un clic. Lus une fois, à l'affichage de l'écran.
 */
function RecentProjects() {
  const known = useAsync(() => api<{ sessions: SessionSummary[] }>("/api/sessions"), []);
  const recents = recentProjects(known.data?.sessions ?? [], []);
  if (recents.length === 0) return null;
  return (
    <div className="mt-3 flex min-h-0 w-full max-w-xl flex-1 flex-col text-left" data-recent-projects>
      <span className="shrink-0 px-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{t("Récents")}</span>
      <ScrollArea className="min-h-0 flex-1">
        <div className="grid gap-0.5">
          {recents.map(({ root, sessions, lastActivityAt }) => (
            <button
              key={root}
              type="button"
              className="flex cursor-pointer items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-accent"
              title={root}
              onClick={() => openProject(root)}
            >
              <span className="shrink-0 font-medium">{root.split(/[\\/]/).pop()}</span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{root}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                {t(sessions === 1 ? "{count} session" : "{count} sessions", { count: sessions })}
                {lastActivityAt ? ` · ${new Date(lastActivityAt).toLocaleDateString()}` : ""}
              </span>
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function Welcome({ root }: { root?: string }) {
  return (
    <div
      className={cn(
        "absolute inset-0 flex flex-col items-center gap-3 p-6 text-center",
        // Sans projet, l'icône et le bouton gardent leur place en haut, quelle que
        // soit la longueur de la liste des récents : elle seule défile.
        root ? "justify-center overflow-auto" : "pt-[10vh]",
      )}
    >
      <div className="grid size-16 place-items-center rounded-full bg-accent text-primary">
        <Sparkles className="size-7" />
      </div>
      <h2 className="text-[15px] font-semibold">{root ? t("Aucun terminal") : t("Aucun projet ouvert")}</h2>
      <p className="font-mono text-[11px] text-muted-foreground">
        {root ?? t("Ouvre un projet pour commencer.")}
      </p>
      {!root && (
        <Button className="mt-1 cursor-pointer" onClick={() => setState({ addingProject: true })}>
          <FolderOpen /> {t("Ouvrir un projet")}
        </Button>
      )}
      {!root && <RecentProjects />}
      {root && (
        <div className="mt-1 flex gap-2">
          <Button className="cursor-pointer" onClick={() => openTerminal("claude", { command: "claude" })}>
            <Sparkles /> {t("Démarrer Claude")}
          </Button>
          <Button variant="outline" className="cursor-pointer" onClick={() => openTerminal("shell")}>
            <TerminalIcon /> Shell
          </Button>
        </div>
      )}
    </div>
  );
}

/** Images d'un collage ou d'un dépôt qui n'ont pas de chemin sur le disque. */
/**
 * Où en est Claude dans un onglet : il attend une réponse, il travaille, ou il a
 * fini sans qu'on l'ait regardé. Au repos et déjà vu, l'onglet n'a rien à dire.
 */
function claudeStatus(busy: boolean, attention: NotificationKind | undefined): string | undefined {
  if (attention === "permission") return t("Claude attend ta réponse");
  if (busy) return t("Claude travaille");
  if (attention) return t("Claude a fini");
  return undefined;
}

function imagesOf(files: Iterable<File>): File[] {
  return [...files].filter((file) => file.type.startsWith("image/"));
}

/**
 * Enregistre des images et tape leurs chemins dans le terminal.
 *
 * Claude Code lit une image désignée par son chemin : une image collée ou déposée
 * sans fichier derrière elle — une capture dans le presse-papiers, une image tirée
 * d'une page web, ou tout fichier déposé dans un navigateur — devient d'abord un
 * fichier.
 */
async function typeImages(terminalId: string, images: File[]): Promise<void> {
  const paths: string[] = [];
  for (const image of images) paths.push(await saveImage(image));
  if (paths.length > 0) typeAsUser(terminalId, `${paths.map(quotePath).join(" ")} `);
}

/**
 * Chemins d'un dépôt sur le terminal.
 *
 * Un glisser depuis le Finder de l'application porte ses chemins et marche
 * partout. Un fichier venu de l'Explorateur n'a de chemin que sous Electron : un
 * navigateur livre son contenu, jamais son emplacement.
 */
function droppedPaths(data: DataTransfer, desktop: Window["clide"]): string[] {
  const internal = data.getData(PATHS_MIME);
  if (internal) {
    try {
      const parsed: unknown = JSON.parse(internal);
      if (Array.isArray(parsed)) return parsed.filter((path): path is string => typeof path === "string");
    } catch {
      // Charge illisible : on retombe sur les fichiers du système.
    }
  }
  if (!desktop) return [];
  return [...data.files]
    .map((file) => desktop.pathForFile(file))
    .filter((path): path is string => Boolean(path));
}

/**
 * Hôte d'une instance xterm.
 *
 * Les instances vivent hors de React et ne sont jamais détruites au rendu : ce
 * composant ne fait que leur prêter un nœud et signaler les redimensionnements.
 *
 * La barre de recherche vit à côté de l'hôte, pas dedans : elle suit l'échelle
 * de l'interface, que le terminal ignore, et reste montée quand on change
 * d'onglet, avec sa recherche.
 */
function TerminalHost({ info, active, underToolbar }: { info: TerminalInfo; active: boolean; underToolbar: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const desktop = window.clide;
  const find = useStore((state) => (state.terminalFind?.id === info.id ? state.terminalFind : null));

  useEffect(() => {
    if (ref.current) mount(info, ref.current, terminalTheme());
  }, [info.id]);

  // Un terminal qui devient visible prend le clavier, sauf à la liste de l'onglet
  // Scripts, qu'on parcourt aux flèches en montrant chaque script, et à la barre
  // d'onglets, où Suppr laisse le focus sur l'onglet voisin. Un clic ou Entrée sur
  // un onglet donne le clavier au terminal par `focusTerminal`.
  useEffect(() => {
    if (!active) return;
    requestAnimationFrame(() =>
      resize(info.id, { focus: !document.activeElement?.closest("[data-scripts-list], [data-tab-bar]") }),
    );
  }, [active, info.id]);

  return (
    <div className={cn("absolute inset-0", active ? "block" : "hidden")}>
      {/* La marge est sur le cadre, pas sur l'hôte : xterm calcule ses lignes sur la
          hauteur de son parent, padding compris en `border-box`, et sa dernière ligne
          déborderait sous le bord. */}
      <div
        className="absolute inset-0 p-2"
        data-unzoom
        onDragOver={(event) => {
          if (desktop || event.dataTransfer.types.includes(PATHS_MIME) || event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
          }
        }}
        onDrop={(event) => {
          const paths = droppedPaths(event.dataTransfer, desktop);
          if (paths.length > 0) {
            event.preventDefault();
            typeAsUser(info.id, `${paths.map(quotePath).join(" ")} `);
            return;
          }
          const images = imagesOf(event.dataTransfer.files);
          if (images.length === 0) return;
          event.preventDefault();
          void typeImages(info.id, images).catch((error: unknown) => console.error("[clide]", error));
        }}
        // En phase de capture, avant que xterm ne colle : une image seule dans le
        // presse-papiers n'a pas de texte à coller. Claude Code la lit lui-même sur
        // son raccourci de collage d'image et la joint au message ; un shell en
        // reçoit le chemin.
        onPasteCapture={(event) => {
          const images = imagesOf(event.clipboardData.files);
          if (images.length === 0 || event.clipboardData.getData("text/plain")) return;
          event.preventDefault();
          event.stopPropagation();
          if (info.kind === "claude") typeAsUser(info.id, IMAGE_PASTE);
          else void typeImages(info.id, images).catch((error: unknown) => console.error("[clide]", error));
        }}
      >
        <div ref={ref} className="size-full" />
      </div>
      {find && (
        <TerminalFind
          terminalId={info.id}
          request={find.request}
          seed={find.seed}
          className={underToolbar ? "top-11" : "top-2"}
        />
      )}
    </div>
  );
}

/** Onglet d'un fichier ouvert : son icône, un point tant qu'il n'est pas enregistré. */
function FileTab({ path, active, onClose, tab }: { path: string; active: boolean; onClose: () => void; tab: TabProps }) {
  const dirty = useStore((state) => state.files[path]?.dirty === true);
  const title = useStore((state) => state.files[path]?.title);
  const name = title ?? baseName(path);
  const iconName = title ? (title.split(" @ ")[0] ?? title) : name;
  return (
    <ContextArea
      items={() => [
        { kind: "item", label: t("Fermer"), icon: X, run: onClose },
        // Un diff ou un transcript n'a pas de chemin de fichier à copier.
        ...(isDiff(path) || isTranscript(path)
          ? []
          : [
              { kind: "separator" as const },
              { kind: "item" as const, label: t("Copier le chemin"), run: () => void navigator.clipboard.writeText(path) },
              { kind: "item" as const, label: t("Montrer dans l'arborescence"), icon: Crosshair, run: () => revealInTree(path) },
            ]),
        { kind: "separator" },
        ...tabGroupItems(getState().activeRoot, path),
      ]}
    >
      <div
        {...tab}
        title={path}
        onClick={() => showFile(path)}
        onAuxClick={(event) => event.button === 1 && onClose()}
        className={cn(
          "group flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 transition-colors",
          TAB_FOCUS,
          active ? "border-border bg-muted text-foreground" : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        <FileIcon name={iconName} directory={false} className="size-3.5" />
        {isDiff(path) && <span className="text-[10px] text-muted-foreground">±</span>}
        <span className={cn(dirty && "italic")}>{name}</span>
        {/* L'italique ne se lit pas : le nom de l'onglet le dit. */}
        {dirty && <span className="sr-only">{`, ${t("modifié")}`}</span>}
        {/* Le point d'un fichier modifié laisse place à la croix au survol, comme dans VS Code. */}
        <span className="relative size-3">
          {dirty && <span className="absolute inset-0.5 rounded-full bg-foreground/70 group-hover:hidden" />}
          <X
            aria-hidden
            className={cn("absolute inset-0 size-3 opacity-50 hover:opacity-100", dirty && "hidden group-hover:block")}
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
          />
        </span>
      </div>
    </ContextArea>
  );
}

/** Fermer un fichier modifié : enregistrer, abandonner les changements, ou y rester. */
function CloseFileDialog({
  path,
  onDone,
  onCloseAutoFocus,
}: {
  path: string | undefined;
  onDone: () => void;
  /** Ouverte sans déclencheur, la fenêtre ne saurait pas à qui rendre le focus. */
  onCloseAutoFocus: (event: Event) => void;
}) {
  return (
    <Dialog open={!!path} onOpenChange={(open) => !open && onDone()}>
      <DialogContent className="sm:max-w-md" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{t("Enregistrer {name} ?", { name: path ? baseName(path) : "" })}</DialogTitle>
          <DialogDescription>{t("Ses changements seront perdus s'ils ne sont pas enregistrés.")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onDone}>
            {t("Annuler")}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              if (path) closeFile(path, { discard: true });
              onDone();
            }}
          >
            {t("Ne pas enregistrer")}
          </Button>
          <Button
            onClick={async () => {
              if (path && (await saveFile(path))) closeFile(path);
              onDone();
            }}
          >
            {t("Enregistrer")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TerminalArea() {
  const {
    terminals,
    activeTerminalId,
    attention,
    activeRoot,
    live,
    followLive,
    sessionCollapsed,
    widths,
  } = useStore((state) => state);
  const project = useStore(activeProject);
  const selectedSession = useStore(selectedSessionOf);
  const sessionMode = useStore(bottomModeOf);
  const disabledModules = useStore((state) => state.disabledModules);
  const showCosts = useStore((state) => state.showCosts);
  const own = Object.values(terminals).filter((entry) => entry.owner === activeRoot);
  const active = activeTerminalId ? terminals[activeTerminalId] : undefined;
  const status = active && active.owner === activeRoot ? active.info : undefined;
  const openFiles = project?.openFiles ?? [];
  const activeFile = project?.activeFile ?? null;
  // Les scripts vivent dans l'onglet Scripts ; la barre a le reste.
  const placed = project?.scripts.placed ?? {};
  const { bar, shelf } = splitTabs(
    own.map((entry) => entry.info),
    placed,
  );
  const barIds = bar.map((info) => info.id);
  const showsScripts = useStore(scriptsShown);
  const refusedInput = useStore((state) => state.refusedInput);
  const terminalNotice = useStore((state) => state.terminalNotice);
  const sessionTab = useStore(sessionTabOf);
  // Terminaux et fichiers mêlés, dans l'ordre où on les a rangés, chaque groupe rassemblé.
  const groups = project?.tabGroups;
  const tabIds = gather(orderTabs(project?.tabOrder ?? [], [...barIds, ...openFiles]), groups?.members ?? {});
  const shownId = activeFile ?? activeTerminalId;
  const byId = new Map(own.map((entry) => [entry.info.id, entry.info]));
  const dropOn = (moved: string, target: string, side: "before" | "after") => {
    if (project) dropOnBar(project.root, moved, target, side);
  };
  // Pendant un glisser, la barre se range déjà comme le lâcher la rangera.
  const reorder = useReorder("center", dropOn);
  const aim = reorder.drag?.aim;
  const arranged = groups && reorder.drag && aim ? dropInBar(groups, tabIds, reorder.drag.id, aim.target, aim.side) : undefined;
  const items = barItems(arranged?.order ?? tabIds, arranged?.groups ?? groups ?? NO_GROUPS);
  const entries = barEntries(items);
  // Une étiquette tirée emmène les onglets de son groupe.
  const dragged = entries.find((entry) => entry.kind === "label" && entry.id === reorder.drag?.id);
  const list = reorder.bind(
    entries.map((entry) => entry.id),
    dragged?.kind === "label" ? dragged.ids : [],
  );
  const [closingGroup, setClosingGroup] = useState<string>();
  // Ce qui avait le focus à l'ouverture d'une fenêtre de confirmation : elle n'a pas
  // de déclencheur à qui le rendre.
  const opener = useRef<Element | null>(null);
  // Un groupe où rien ne vit se ferme d'un coup ; sinon, on dit ce qu'il porte avant.
  // Vrai s'il est fermé tout de suite.
  const requestCloseGroup = (group: string): boolean => {
    if (!project) return false;
    const contents = contentsOf(project.root, group);
    if (contents.claude + contents.commands + contents.dirty === 0) {
      closeGroup(project.root, group);
      return true;
    }
    opener.current = document.activeElement;
    setClosingGroup(group);
    return false;
  };
  const renamingTab = useStore((state) => state.renamingTab);
  const claudeBusy = useStore((state) => state.claudeBusy);
  const endRename = (id: string) => {
    setState({ renamingTab: null });
    // Validé au clavier, le champ disparaît sans rendre le focus : le terminal montré le reprend.
    requestAnimationFrame(() => {
      if (document.activeElement === document.body && id === getState().activeTerminalId) resize(id, { focus: true });
    });
  };
  const [closing, setClosing] = useState<string>();
  // Un fichier modifié ne se ferme pas sans qu'on ait choisi quoi faire de ses
  // changements. Vrai s'il est fermé tout de suite.
  const requestClose = (path: string): boolean => {
    if (closeFile(path)) return true;
    opener.current = document.activeElement;
    setClosing(path);
    return false;
  };

  // La barre est un tablist à activation manuelle : les flèches passent d'une
  // entrée à l'autre sans rien montrer, Entrée montre. Seule l'entrée qui montre
  // l'onglet affiché est dans l'ordre de tabulation, ou la première s'il n'est pas
  // dans la barre.
  const tabBar = useRef<HTMLDivElement>(null);
  const tabNodes = useRef(new Map<string, HTMLDivElement>());
  const panelId = useId();
  const selected = holderOf(entries, shownId);
  const stop = selected ?? entries[0]?.id;
  const tabProps = (id: string, index: number): TabProps => {
    const ref = (node: HTMLDivElement | null) => {
      if (node) tabNodes.current.set(id, node);
      else tabNodes.current.delete(id);
    };
    if (renamingTab === id) return { ref };
    return {
      ref,
      role: "tab",
      id: `${panelId}-${index}`,
      tabIndex: id === stop ? 0 : -1,
      "aria-selected": id === selected,
      "aria-controls": panelId,
      "aria-keyshortcuts": "Delete",
    };
  };
  /** L'entrée de la barre dans l'ordre de tabulation, ou le `+` s'il n'y en a plus. */
  const barStop = () => tabBar.current?.querySelector<HTMLElement>('[role="tab"][tabindex="0"], [data-new-tab]');

  // Une fenêtre de confirmation rend le focus à ce qui l'avait ; parti avec ce
  // qu'elle a fermé, il va à la barre.
  const returnFocus = (event: Event) => {
    event.preventDefault();
    const back = opener.current;
    opener.current = null;
    requestAnimationFrame(() => (back instanceof HTMLElement && back.isConnected ? back : barStop())?.focus());
  };

  /**
   * Suppr sur une entrée : la ferme comme sa croix ou son menu. Le focus passe à
   * la voisine, ou à l'onglet montré après la fermeture si c'était celui-là, ou
   * au `+` s'il ne reste rien. Une fenêtre de confirmation qui s'ouvre le rend
   * elle-même en se fermant (`returnFocus`).
   */
  const closeEntry = (id: string) => {
    const index = entries.findIndex((item) => item.id === id);
    const entry = entries[index];
    if (!entry) return;
    // Une étiquette part avec les onglets de son groupe : la voisine se cherche au-delà.
    const gone = (item: BarEntry) =>
      item.id === id || (entry.kind === "label" && item.kind === "tab" && item.block?.group.id === entry.group.id);
    const neighbour = (entries.slice(index + 1).find((item) => !gone(item)) ?? entries.slice(0, index).reverse().find((item) => !gone(item)))?.id;
    const wasShown = id === selected;
    let closed = true;
    if (entry.kind === "label") closed = requestCloseGroup(entry.group.id);
    else if (byId.has(id)) closeTerminal(id);
    else closed = requestClose(id);
    if (!closed) return;
    // Après le rendu : la voisine peut être partie avec l'entrée, et l'arrêt a changé de place.
    requestAnimationFrame(() => ((!wasShown && neighbour ? tabNodes.current.get(neighbour) : undefined) ?? barStop())?.focus());
  };

  const onBarKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    // Le champ d'un renommage garde ses touches : seules celles d'une entrée comptent.
    const focused = entries.find((entry) => tabNodes.current.get(entry.id) === event.target)?.id;
    if (!focused) return;
    const target = barMove(entries.map((entry) => entry.id), focused, event.key);
    if (target) tabNodes.current.get(target)?.focus();
    else if (event.key === "Enter" || event.key === " ") tabNodes.current.get(focused)?.click();
    else if (event.key === "Delete") closeEntry(focused);
    else return;
    event.preventDefault();
  };
  // La session du terminal montré, pour son pied et sa barre flottante ; celle que
  // suit le bloc du bas, qui reste sur l'onglet Claude quitté pour l'onglet Scripts.
  const current = status ? live[status.id] : undefined;
  const followed = sessionTab ? live[sessionTab] : undefined;
  const servers = useDevServers(own.map((entry) => entry.info));
  const listStart = useRef(0);

  // Le terminal perd ou regagne la place de l'îlot du bas : xterm doit se remesurer.
  useEffect(() => {
    requestAnimationFrame(resizeActive);
  }, [widths.bottom, sessionCollapsed]);

  // Tout changement de taille du cadre réajuste le terminal montré, y compris
  // quand rien de ce qui l'entoure n'appelle `resizeActive` : xterm garderait des
  // lignes que le cadre ne montre plus, et la dernière serait rognée. Il ne prend
  // pas le clavier : un champ qu'on remplit à ce moment-là le garde.
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    const observer = new ResizeObserver(() =>
      requestAnimationFrame(() => {
        const { activeTerminalId } = getState();
        if (activeTerminalId) resize(activeTerminalId, { focus: false });
      }),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const center = useRef<HTMLDivElement>(null);
  const bottomStart = useRef(0);

  // Rattachée dès son démarrage par les hooks, une session n'a rien à montrer
  // avant son premier prompt : son transcript n'existe pas encore.
  const starting = followLive && followed !== undefined && followed.lastActivityAt === undefined;
  // Une session de History est montrée alors que l'onglet actif en a une vivante.
  const detached = !followLive && followed !== undefined;
  // L'onglet actif l'emporte tant qu'on ne choisit pas une session dans History.
  const shown: (ShownSession & { title?: string }) | undefined = starting
    ? undefined
    : followLive && followed
      ? {
          sessionId: followed.sessionId,
          ...(followed.title ? { title: followed.title } : {}),
          ...(followed.lastActivityAt ? { refresh: followed.lastActivityAt } : {}),
          ...(followed.model ? { model: followed.model } : {}),
          ...(followed.tokens ? { tokens: followed.tokens } : {}),
          ...(followed.price ? { price: followed.price } : {}),
        }
      : selectedSession
        ? {
            sessionId: selectedSession.sessionId,
            ...(selectedSession.title ? { title: selectedSession.title } : {}),
            ...(selectedSession.price ? { price: selectedSession.price } : {}),
          }
        : undefined;

  const sessionModes: Mode[] = [
    {
      id: "plan",
      doc: "session#le-plan-d-une-session",
      icon: ClipboardList,
      title: "Plan",
      about: t("Le plan soumis en sortant du mode plan, avec sa progression s'il porte des cases."),
      render: () => (shown ? <PlanPanel session={shown} /> : null),
    },
    {
      id: "activity",
      doc: "session#la-session-d-un-onglet",
      icon: Activity,
      title: t("Activité"),
      defaultOrder: t("ordre chronologique"),
      about: t("Le déroulé de la session : prompts, réponses et appels d'outils."),
      render: () => (shown ? <ActivityPanel session={shown} /> : null),
    },
    {
      id: "captures",
      doc: "session#captures",
      icon: Images,
      title: t("Captures"),
      defaultOrder: t("ordre chronologique"),
      about: t("Les images de la session, sous-agents compris : captures prises par Claude, images collées."),
      render: () => (shown ? <CapturesPanel session={shown} /> : null),
    },
    {
      id: "files",
      doc: "session#restaurer-un-fichier",
      icon: FileDiff,
      title: t("Fichiers"),
      defaultOrder: t("ordre alphabétique"),
      about: t(
        "Ce que la session a changé, avec le diff exact. L'état « avant » vient des sauvegardes de Claude Code, pas de git.",
      ),
      render: () =>
        shown ? (
          <FilesPanel session={shown} />
        ) : (
          <p className="py-6 text-center text-muted-foreground">
            {starting
              ? t("La session démarre : le bloc se remplit au premier prompt.")
              : t("Lance Claude dans un onglet, ou choisis une session dans History.")}
          </p>
        ),
    },
    {
      id: "diagram",
      doc: "session#schema-de-la-session",
      icon: Workflow,
      title: t("Schéma"),
      about: t("Un diagramme de ce que la session a changé, rédigé à la demande par claude -p : il coûte des tokens."),
      render: () => (shown ? <DiagramPanel session={shown} /> : null),
    },
    {
      id: "writeup",
      doc: "session#message-de-commit-et-description-de-mr",
      icon: PenLine,
      title: t("Rédaction"),
      about: t("Un message de commit ou une description de MR pour la session, rédigé à la demande par claude -p : il coûte des tokens."),
      render: () => (shown ? <WriteupPanel session={shown} /> : null),
    },
  ];
  // Les modules ajoutent leurs modes après ceux de la session ; ils portent sur le projet.
  const modes: Mode[] = [
    ...sessionModes,
    ...(project
      ? moduleBottomViews(disabledModules).map((view) => ({
          id: view.id,
          icon: view.icon,
          title: t(view.title),
          about: t(view.about),
          ...(view.doc ? { doc: view.doc } : {}),
          render: () => view.render(project.root),
        }))
      : []),
  ];

  /** Un onglet de la barre, terminal ou fichier ; `className` porte sa teinte de groupe et son écart. */
  const renderTab = (id: string, index: number, className: string) => {
    const info = byId.get(id);
    return (
      <ReorderItem key={id} list={list} id={id} fixed={renamingTab === id} className={className}>
        {!info ? (
          <FileTab path={id} active={id === activeFile} onClose={() => requestClose(id)} tab={tabProps(id, index)} />
        ) : (
          <ContextArea items={() => [...tabItems(info, barIds), { kind: "separator" }, ...tabGroupItems(project?.root ?? null, info.id)]}>
            <div
              {...tabProps(id, index)}
              onClick={(event) => {
                // Le second clic d'un double-clic laisserait le terminal prendre le focus au champ du nom.
                if (event.detail > 1) return;
                focusTerminal(info.id);
                showTerminals();
              }}
              onDoubleClick={() => {
                // Le premier clic donne le focus au terminal à la frame suivante : le champ s'ouvre après.
                if (!info.exited) requestAnimationFrame(() => setState({ renamingTab: info.id }));
              }}
              title={info.kind === "claude" ? claudeStatus(Boolean(claudeBusy[info.id]), attention[info.id]) : undefined}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1 transition-colors",
                TAB_FOCUS,
                info.id === activeTerminalId && !activeFile
                  ? "border-border bg-muted text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {info.kind === "claude" ? (
                // Le processus `claude` tourne tant que la session est ouverte : c'est le
                // titre de son terminal qui dit s'il travaille.
                <Sparkles className={cn("size-3", claudeBusy[info.id] ? "animate-pulse text-amber-500" : "text-primary")} />
              ) : (
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    info.state === "running"
                      ? "bg-amber-500"
                      : info.state === "failed"
                        ? "bg-destructive"
                        : "bg-muted-foreground",
                  )}
                />
              )}
              {renamingTab === info.id ? (
                <NameInput
                  whole
                  initial={info.title}
                  label={t("Nom de l'onglet")}
                  className="w-40 flex-none"
                  onSubmit={(value) => {
                    if (value.trim() !== info.title) {
                      renameTerminal(info.id, value);
                      void renameSession(info.id, value);
                    }
                    endRename(info.id);
                  }}
                  onCancel={() => endRename(info.id)}
                />
              ) : (
                <span>{info.title}</span>
              )}
              {attention[info.id] === "permission" ? (
                <CircleAlert className="size-3 text-amber-500" />
              ) : (
                attention[info.id] && <span className="size-2 rounded-full bg-emerald-500" />
              )}
              <X
                aria-hidden
                className="size-3 opacity-50 hover:opacity-100"
                onClick={(event) => {
                  event.stopPropagation();
                  closeTerminal(info.id);
                }}
              />
            </div>
          </ContextArea>
        )}
      </ReorderItem>
    );
  };

  return (
    <div ref={center} className="flex min-h-0 min-w-0 flex-1 flex-col">
    <Island className="min-h-0 flex-1">
      <div ref={tabBar} className="flex shrink-0 items-center gap-1.5 px-2 py-1.5">
        {/* Épinglé hors du défilement des onglets : rien ne passe devant, il ne se range pas. */}
        {project && (
          <>
            <ScriptsTab shelf={shelf} shown={showsScripts} />
            <span className="h-4 w-px shrink-0 bg-border" />
          </>
        )}
        <nav
          {...list.zone}
          role="tablist"
          aria-label={t("Onglets du projet")}
          data-tab-bar
          onKeyDown={onBarKeyDown}
          // Le focus seul laisse à moitié cachée une entrée au bord de la barre qui défile.
          onFocus={(event) => event.target.scrollIntoView({ block: "nearest", inline: "nearest" })}
          // Le défilement rognerait l'anneau du focus : la marge le contient sans rien décaler.
          className="-m-[3px] flex flex-1 overflow-x-auto p-[3px] [scrollbar-width:none]"
        >
          {entries.map((entry, index) => {
            // Le cadre teinté dit quels onglets vont ensemble : chaque élément du groupe
            // en porte sa part, l'écart compris, arrondie aux deux bouts du bloc.
            const group = entry.kind === "label" ? entry.group : entry.block?.group;
            const tint = group && GROUP_STYLE[group.color].tint;
            if (entry.kind === "tab") {
              const place = entry.block ? cn("pl-1", entry.block.last && "rounded-r-lg") : index > 0 && "ml-1";
              return renderTab(entry.id, index, cn(tint, place));
            }
            return (
              <ReorderItem
                key={entry.id}
                list={list}
                id={entry.id}
                holds
                fixed={renamingTab === entry.id}
                className={cn("flex items-center", tint, entry.alone ? "rounded-lg" : "rounded-l-lg", index > 0 && "ml-1")}
              >
                <GroupLabel
                  root={project?.root ?? ""}
                  group={entry.group}
                  ids={entry.ids}
                  active={entry.group.folded && shownId !== null && entry.ids.includes(shownId)}
                  onClose={() => requestCloseGroup(entry.group.id)}
                  tab={tabProps(entry.id, index)}
                />
              </ReorderItem>
            );
          })}
        </nav>
        <NewTabMenu disabled={!project} terminalId={status?.id} />
      </div>

      <CloseFileDialog path={closing} onDone={() => setClosing(undefined)} onCloseAutoFocus={returnFocus} />
      <CloseGroupDialog
        root={project?.root ?? null}
        group={groups?.groups.find((group) => group.id === closingGroup)}
        onDone={() => setClosingGroup(undefined)}
        onCloseAutoFocus={returnFocus}
      />

      <div className="mx-2 flex min-h-0 flex-1">
        {/* La liste se glisse à gauche du cadre des terminaux, qui rétrécit : aucun hôte ne change de parent. */}
        {showsScripts && (
          <>
            <ScriptsList shelf={shelf} shownId={status?.id ?? null} width={widths.scripts} />
            <Splitter
              onStart={() => (listStart.current = getState().widths.scripts)}
              onDrag={(dx) => {
                setState((state) => ({ widths: { ...state.widths, scripts: clamp(listStart.current + dx, 140, 640) } }));
                requestAnimationFrame(resizeActive);
              }}
              onReset={() => {
                setState((state) => ({ widths: { ...state.widths, scripts: DEFAULT_WIDTHS.scripts } }));
                requestAnimationFrame(resizeActive);
              }}
            />
          </>
        )}
        <div
          ref={frame}
          role="tabpanel"
          id={panelId}
          aria-labelledby={selected ? `${panelId}-${entries.findIndex((entry) => entry.id === selected)}` : undefined}
          className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border bg-[var(--term-bg)]"
        >
          {!status && !activeFile && <Welcome root={project?.root} />}
          {Object.values(terminals).map(({ info }) => (
            <TerminalHost
              key={info.id}
              info={info}
              active={info.id === status?.id && !activeFile}
              // La barre d'outils ci-dessous, quand le terminal en a une : la recherche se range dessous.
              underToolbar={info.kind === "claude" ? !info.exited : Boolean(info.script) || placementOf(info, placed) === "scripts"}
            />
          ))}
          {status?.kind === "claude" && !status.exited && !activeFile && (
            <ClaudeToolbar terminalId={status.id} currentModel={current?.model} currentEffort={current?.effort} servers={servers} />
          )}
          {status?.kind === "shell" && (status.script || placementOf(status, placed) === "scripts") && !activeFile && (
            <ScriptToolbar info={status} inScripts={placementOf(status, placed) === "scripts"} />
          )}
          {refusedInput === status?.id && !activeFile && (
            <div
              role="status"
              className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-md border bg-card px-3 py-1.5 text-[12px] whitespace-nowrap shadow-sm"
            >
              {t("Script terminé : ▷ le relance. Pour taper une commande, ouvre un shell.")}
            </div>
          )}
          {terminalNotice && terminalNotice.id === status?.id && !activeFile && (
            <div
              role="status"
              className="pointer-events-none absolute bottom-3 left-1/2 z-10 w-max max-w-[80%] -translate-x-1/2 rounded-md border bg-card px-3 py-1.5 text-center text-[12px] shadow-sm"
              data-terminal-notice
            >
              {terminalNotice.text}
            </div>
          )}
          {activeFile && (
            <div className="absolute inset-0 bg-background">
              <EditorPane path={activeFile} />
            </div>
          )}
        </div>
      </div>

      <footer className="shrink-0 overflow-x-auto px-3 py-1.5 text-[11px] whitespace-nowrap text-muted-foreground [scrollbar-width:none]">
        {status
          ? [
              status.cwd,
              status.kind,
              status.state,
              status.lastExitCode !== undefined ? t("sortie {code}", { code: status.lastExitCode }) : "",
              current?.planMode
                ? t("mode plan")
                : current?.permissionMode
                  ? t("permissions {mode}", { mode: current.permissionMode })
                  : "",
              current?.tokens ? t("contexte {tokens}", { tokens: formatTokens(current.tokens.context) }) : "",
              (showCosts && formatSessionCost(current?.price)) || "",
            ]
              .filter(Boolean)
              .join("   ·   ")
          : ""}
      </footer>

    </Island>

    {/* Sans projet ouvert, le bloc du bas s'efface comme la colonne du projet : l'accueil a tout le centre. */}
    {project && !sessionCollapsed && (
      <Splitter
        orientation="horizontal"
        className="on-canvas"
        onStart={() => (bottomStart.current = getState().widths.bottom)}
        onDrag={(dy) => {
          const height = center.current?.clientHeight ?? 1;
          // Le terminal garde de quoi lire quelques lignes, le bloc de quoi montrer ses modes.
          const max = 1 - TERMINAL_MIN_HEIGHT / height;
          setState((current) => ({
            widths: { ...current.widths, bottom: clamp(bottomStart.current - dy / height, 0.12, max) },
          }));
          requestAnimationFrame(resizeActive);
        }}
        onReset={() => {
          setState((current) => ({ widths: { ...current.widths, bottom: DEFAULT_WIDTHS.bottom } }));
          requestAnimationFrame(resizeActive);
        }}
      />
    )}

    {project && (
    <div
      className={cn("flex min-h-0 shrink-0 [&>*]:flex-1", sessionCollapsed && "mt-1")}
      style={sessionCollapsed ? undefined : { height: `${widths.bottom * 100}%` }}
    >
    <Island>
      <ModeBlock
        block="session"
        modes={modes}
        current={sessionMode}
        onPick={(id) => setBottomMode(id)}
        header={
          // Le titre se tronque, la puce reste entière : elle est ce qui dit que
          // le bloc ne montre pas l'onglet.
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate">{shown?.title}</span>
            {detached && (
              <button
                type="button"
                className="shrink-0 rounded-full border px-1.5 text-[10px] hover:bg-accent hover:text-foreground"
                title={t("Le bloc montre une session choisie dans History ; l'onglet actif en a une autre. Cliquer pour suivre l'onglet.")}
                onClick={() => setState({ followLive: true })}
              >
                {t("détaché")}
              </button>
            )}
          </span>
        }
        collapsed={sessionCollapsed}
        onCollapse={(value) => {
          setState({ sessionCollapsed: value });
          requestAnimationFrame(resizeActive);
        }}
        className="border-t-0"
      />
    </Island>
    </div>
    )}
    </div>
  );
}
