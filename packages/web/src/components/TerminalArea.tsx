import {
  Activity,
  ClipboardList,
  FileDiff,
  FolderOpen,
  Images,
  PenLine,
  Sparkles,
  Terminal as TerminalIcon,
  Workflow,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { baseName } from "@/lib/fs";
import { dropTab, orderTabs } from "@/lib/tab-order";
import { Reorderable } from "@/components/Reorderable";
import { closeFile, isDiff, isTranscript, saveFile, showFile, showTerminals } from "@/state/editor";
import { formatSessionCost } from "@/components/panels/costs";
import { CapturesPanel } from "@/components/panels/captures";
import { DiagramPanel } from "@/components/panels/diagram";
import { WriteupPanel } from "@/components/panels/writeup";
import { ActivityPanel, FilesPanel, PlanPanel, formatTokens, type ShownSession } from "@/components/panels/session";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import { t } from "@/i18n";
import { placementOf, splitTabs } from "@/lib/script-shelf";
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
  resize,
  resizeActive,
  sendToClaude,
  typeAsUser,
} from "@/state/terminals";
import { PATHS_MIME, api, quotePath, saveImage } from "@/lib/api";
import { recentProjects } from "@/lib/recents";
import { useAsync } from "@/components/common";
import type { SessionSummary, TerminalInfo } from "@/lib/types";

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
    <div className="mt-3 grid w-full max-w-xl gap-0.5 text-left" data-recent-projects>
      <span className="px-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{t("Récents")}</span>
      {recents.map(({ root, sessions, lastActivityAt }) => (
        <button
          key={root}
          type="button"
          className="flex items-baseline gap-2 rounded-md px-2 py-1.5 text-[12px] hover:bg-accent"
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
  );
}

function Welcome({ root }: { root?: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-auto p-6 text-center">
      <div className="grid size-16 place-items-center rounded-full bg-accent text-primary">
        <Sparkles className="size-7" />
      </div>
      <h2 className="text-[15px] font-semibold">{root ? t("Aucun terminal") : t("Aucun projet ouvert")}</h2>
      <p className="font-mono text-[11px] text-muted-foreground">
        {root ?? t("Ouvre un projet pour commencer.")}
      </p>
      {!root && (
        <Button className="mt-1" onClick={() => setState({ addingProject: true })}>
          <FolderOpen /> {t("Ouvrir un projet")}
        </Button>
      )}
      {!root && <RecentProjects />}
      {root && (
        <div className="mt-1 flex gap-2">
          <Button onClick={() => openTerminal("claude", { command: "claude" })}>
            <Sparkles /> {t("Démarrer Claude")}
          </Button>
          <Button variant="outline" onClick={() => openTerminal("shell")}>
            <TerminalIcon /> Shell
          </Button>
        </div>
      )}
    </div>
  );
}

/** Images d'un collage ou d'un dépôt qui n'ont pas de chemin sur le disque. */
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
 */
function TerminalHost({ info, active }: { info: TerminalInfo; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const desktop = window.clide;

  useEffect(() => {
    if (ref.current) mount(info, ref.current, terminalTheme());
  }, [info.id]);

  // Un terminal qui devient visible prend le clavier, sauf à la liste de l'onglet
  // Scripts : on la parcourt aux flèches en montrant chaque script.
  useEffect(() => {
    if (!active) return;
    requestAnimationFrame(() => resize(info.id, { focus: !document.activeElement?.closest("[data-scripts-list]") }));
  }, [active, info.id]);

  return (
    // La marge est sur le cadre, pas sur l'hôte : xterm calcule ses lignes sur la
    // hauteur de son parent, padding compris en `border-box`, et sa dernière ligne
    // déborderait sous le bord.
    <div
      className={cn("absolute inset-0 p-2", active ? "block" : "hidden")}
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
      // presse-papiers n'a pas de texte à coller, elle devient un chemin.
      onPasteCapture={(event) => {
        const images = imagesOf(event.clipboardData.files);
        if (images.length === 0 || event.clipboardData.getData("text/plain")) return;
        event.preventDefault();
        event.stopPropagation();
        void typeImages(info.id, images).catch((error: unknown) => console.error("[clide]", error));
      }}
    >
      <div ref={ref} className="size-full" />
    </div>
  );
}

/**
 * Prompts mis en file dans l'onglet Claude regardé, dans l'ordre où Claude les
 * prendra, et de quoi en ajouter un.
 *
 * Ajouter revient à taper dans l'onglet : Claude Code met lui-même en file ce qui
 * arrive pendant qu'il travaille. Retirer n'est pas offert : Claude Code ne
 * l'expose pas, et le simuler au clavier dans son interface pourrait viser le
 * mauvais prompt.
 */
function QueueStrip({ queue }: { queue: { text: string; at?: string }[] }) {
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  if (queue.length === 0 && !adding) {
    return (
      <div className="flex shrink-0 justify-end px-3 pt-1">
        <button
          type="button"
          className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => setAdding(true)}
        >
          {t("mettre un prompt en file")}
        </button>
      </div>
    );
  }
  return (
    <div className="mx-2 mt-1 shrink-0 rounded-md border px-2 py-1.5 text-[12px]">
      {queue.length > 0 && (
        <>
          <div className="mb-1 text-[11px] text-muted-foreground">{t("En attente ({count})", { count: queue.length })}</div>
          <ol className="m-0 grid list-decimal gap-0.5 pl-5">
            {queue.map((entry, index) => (
              <li key={`${index}|${entry.text}`} className="truncate" title={entry.text}>
                {entry.text}
              </li>
            ))}
          </ol>
        </>
      )}
      <form
        className="mt-1 flex gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          const text = draft.trim();
          if (!text) return;
          // Une ligne : un retour à la ligne enverrait le prompt en morceaux.
          if (sendToClaude(text.replace(/\s*\n\s*/g, " "))) setDraft("");
        }}
      >
        <input
          className="h-7 min-w-0 flex-1 rounded border bg-transparent px-2 text-[12px] outline-none focus:border-primary"
          value={draft}
          placeholder={t("prompt à mettre en file")}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button type="submit" variant="outline" size="sm" className="h-7 text-[11px]">
          {t("ajouter")}
        </Button>
      </form>
    </div>
  );
}

/** Onglet d'un fichier ouvert : son icône, un point tant qu'il n'est pas enregistré. */
function FileTab({ path, active, onClose }: { path: string; active: boolean; onClose: () => void }) {
  const dirty = useStore((state) => state.files[path]?.dirty === true);
  const title = useStore((state) => state.files[path]?.title);
  const name = title ?? baseName(path);
  const iconName = title ? (title.split(" @ ")[0] ?? title) : name;
  return (
    <ContextArea
      items={[
        { kind: "item", label: t("Fermer"), icon: X, run: onClose },
        // Un diff ou un transcript n'a pas de chemin de fichier à copier.
        ...(isDiff(path) || isTranscript(path)
          ? []
          : [
              { kind: "separator" as const },
              { kind: "item" as const, label: t("Copier le chemin"), run: () => void navigator.clipboard.writeText(path) },
            ]),
      ]}
    >
      <div
        title={path}
        onClick={() => showFile(path)}
        onAuxClick={(event) => event.button === 1 && onClose()}
        className={cn(
          "group flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 transition-colors",
          active ? "border-border bg-muted text-foreground" : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        <FileIcon name={iconName} directory={false} className="size-3.5" />
        {isDiff(path) && <span className="text-[10px] text-muted-foreground">±</span>}
        <span className={cn(dirty && "italic")}>{name}</span>
        {/* Le point d'un fichier modifié laisse place à la croix au survol, comme dans VS Code. */}
        <span className="relative size-3">
          {dirty && <span className="absolute inset-0.5 rounded-full bg-foreground/70 group-hover:hidden" />}
          <X
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
function CloseFileDialog({ path, onDone }: { path: string | undefined; onDone: () => void }) {
  return (
    <Dialog open={!!path} onOpenChange={(open) => !open && onDone()}>
      <DialogContent className="sm:max-w-md">
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
  const sessionTab = useStore(sessionTabOf);
  // Terminaux et fichiers mêlés, dans l'ordre où on les a rangés.
  const tabIds = orderTabs(project?.tabOrder ?? [], [...barIds, ...openFiles]);
  const byId = new Map(own.map((entry) => [entry.info.id, entry.info]));
  const dropOn = (moved: string, target: string, side: "before" | "after") => {
    if (project) updateProject(project.root, { tabOrder: dropTab(tabIds, moved, target, side) });
  };
  const [closing, setClosing] = useState<string>();
  // Un fichier modifié ne se ferme pas sans qu'on ait choisi quoi faire de ses changements.
  const requestClose = (path: string) => {
    if (!closeFile(path)) setClosing(path);
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

  return (
    <div ref={center} className="flex min-h-0 min-w-0 flex-1 flex-col">
    <Island className="min-h-0 flex-1">
      <div className="flex shrink-0 items-center gap-1.5 px-2 py-1.5">
        {/* Épinglé hors du défilement des onglets : rien ne passe devant, il ne se range pas. */}
        {project && (
          <>
            <ScriptsTab shelf={shelf} shown={showsScripts} />
            <span className="h-4 w-px shrink-0 bg-border" />
          </>
        )}
        <nav className="flex flex-1 gap-1 overflow-x-auto [scrollbar-width:none]">
          {tabIds.map((id) => {
            const info = byId.get(id);
            return (
              <Reorderable key={id} group="center" id={id} onDrop={dropOn}>
                {!info ? (
                  <FileTab path={id} active={id === activeFile} onClose={() => requestClose(id)} />
                ) : (
                  <ContextArea items={() => tabItems(info, barIds)}>
                    <div
                      onClick={() => {
                        focusTerminal(info.id);
                        showTerminals();
                      }}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1 transition-colors",
                        info.id === activeTerminalId && !activeFile
                          ? "border-border bg-muted text-foreground"
                          : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      {info.kind === "claude" ? (
                        <Sparkles
                          className={cn(
                            "size-3",
                            info.state === "running"
                              ? "text-amber-500"
                              : info.state === "failed"
                                ? "text-destructive"
                                : "text-primary",
                          )}
                        />
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
                      <span>{info.title}</span>
                      {attention[info.id] && <span className="size-1.5 rounded-full bg-primary" />}
                      <X
                        className="size-3 opacity-50 hover:opacity-100"
                        onClick={(event) => {
                          event.stopPropagation();
                          closeTerminal(info.id);
                        }}
                      />
                    </div>
                  </ContextArea>
                )}
              </Reorderable>
            );
          })}
        </nav>
        <NewTabMenu disabled={!project} terminalId={status?.id} />
      </div>

      <CloseFileDialog path={closing} onDone={() => setClosing(undefined)} />

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
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border bg-[var(--term-bg)]">
          {!status && !activeFile && <Welcome root={project?.root} />}
          {Object.values(terminals).map(({ info }) => (
            <TerminalHost key={info.id} info={info} active={info.id === status?.id && !activeFile} />
          ))}
          {status?.kind === "claude" && !status.exited && !activeFile && (
            <ClaudeToolbar currentModel={current?.model} currentEffort={current?.effort} servers={servers} />
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

      {status?.kind === "claude" && current && <QueueStrip queue={current.queue ?? []} />}
    </Island>

    {!sessionCollapsed && (
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
    </div>
  );
}
