import {
  Activity,
  Camera,
  ClipboardList,
  FileDiff,
  Images,
  MonitorPlay,
  Plus,
  Sparkles,
  Terminal as TerminalIcon,
  Workflow,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Island } from "@/components/columns";
import { DevPreview, devServers } from "@/components/DevPreview";
import { ModeBlock, type Mode } from "@/components/ModeBlock";
import { formatSessionCost } from "@/components/panels/costs";
import { CapturesPanel } from "@/components/panels/captures";
import { DiagramPanel } from "@/components/panels/diagram";
import { ActivityPanel, FilesPanel, PlanPanel, formatTokens, type ShownSession } from "@/components/panels/session";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import { t } from "@/i18n";
import { activeProject, setState, useStore } from "@/state/store";
import { terminalTheme } from "@/state/theme";
import {
  closeTerminal,
  focusTerminal,
  mount,
  openTerminal,
  resize,
  resizeActive,
  sendToClaude,
  typeInto,
} from "@/state/terminals";
import { PATHS_MIME, quotePath, saveImage } from "@/lib/api";
import { captureInto } from "@/state/commands";
import type { TerminalInfo } from "@/lib/types";

/** Accueil affiché tant qu'aucun terminal n'est ouvert pour ce projet. */
function Welcome({ root }: { root?: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="grid size-16 place-items-center rounded-full bg-accent text-primary">
        <Sparkles className="size-7" />
      </div>
      <h2 className="text-[15px] font-semibold">{root ? t("Aucun terminal") : t("Aucun projet ouvert")}</h2>
      <p className="font-mono text-[11px] text-muted-foreground">
        {root ?? t("Ouvre un projet pour commencer.")}
      </p>
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
  if (paths.length > 0) typeInto(terminalId, `${paths.map(quotePath).join(" ")} `);
}

/**
 * Chemins d'un dépôt sur le terminal.
 *
 * Un glisser depuis le Finder de l'application porte ses chemins et marche
 * partout. Un fichier venu de l'Explorateur n'a de chemin que sous Electron : un
 * navigateur livre son contenu, jamais son emplacement.
 */
function droppedPaths(data: DataTransfer, desktop: Window["claudeIde"]): string[] {
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
  const desktop = window.claudeIde;

  useEffect(() => {
    if (ref.current) mount(info, ref.current, terminalTheme());
  }, [info.id]);

  useEffect(() => {
    if (active) requestAnimationFrame(() => resize(info.id));
  }, [active, info.id]);

  return (
    <div
      ref={ref}
      className={cn("absolute inset-0 p-2", active ? "block" : "hidden")}
      onDragOver={(event) => {
        if (desktop || event.dataTransfer.types.includes(PATHS_MIME) || event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
        }
      }}
      onDrop={(event) => {
        const paths = droppedPaths(event.dataTransfer, desktop);
        if (paths.length > 0) {
          event.preventDefault();
          typeInto(info.id, `${paths.map(quotePath).join(" ")} `);
          return;
        }
        const images = imagesOf(event.dataTransfer.files);
        if (images.length === 0) return;
        event.preventDefault();
        void typeImages(info.id, images).catch((error: unknown) => console.error("[claude-ide]", error));
      }}
      // En phase de capture, avant que xterm ne colle : une image seule dans le
      // presse-papiers n'a pas de texte à coller, elle devient un chemin.
      onPasteCapture={(event) => {
        const images = imagesOf(event.clipboardData.files);
        if (images.length === 0 || event.clipboardData.getData("text/plain")) return;
        event.preventDefault();
        event.stopPropagation();
        void typeImages(info.id, images).catch((error: unknown) => console.error("[claude-ide]", error));
      }}
    />
  );
}

/**
 * Capture d'une zone de l'écran, dont le chemin est tapé dans l'onglet actif.
 *
 * La capture est menée par l'outil de Windows ; la requête attend qu'elle soit
 * faite. Pendant ce temps le bouton reste occupé, et un second clic n'en ouvre
 * pas une deuxième.
 */
function CaptureButton({ terminalId }: { terminalId: string | undefined }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-7"
      disabled={!terminalId || busy}
      title={error ?? t("Capture d'écran vers le prompt")}
      onClick={async () => {
        if (!terminalId) return;
        setBusy(true);
        setError(undefined);
        try {
          await captureInto(terminalId);
        } catch (caught) {
          setError((caught as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Camera className={busy ? "animate-pulse" : undefined} />
    </Button>
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

export function TerminalArea() {
  const {
    terminals,
    activeTerminalId,
    attention,
    activeRoot,
    selectedSession,
    sessionMode,
    live,
    followLive,
    sessionCollapsed,
    previewOpen,
  } = useStore((state) => state);
  const project = useStore(activeProject);
  const own = Object.values(terminals).filter((entry) => entry.owner === activeRoot);
  const active = activeTerminalId ? terminals[activeTerminalId] : undefined;
  const status = active && active.owner === activeRoot ? active.info : undefined;
  const current = status ? live[status.id] : undefined;
  const serving = devServers(own.map((entry) => entry.info)).length > 0;

  // Le terminal perd ou regagne la place de l'aperçu : xterm doit se remesurer.
  useEffect(() => {
    requestAnimationFrame(resizeActive);
  }, [previewOpen]);

  // L'onglet actif l'emporte tant qu'on ne choisit pas une session dans History.
  const shown: (ShownSession & { title?: string }) | undefined =
    followLive && current
      ? {
          sessionId: current.sessionId,
          ...(current.title ? { title: current.title } : {}),
          ...(current.lastActivityAt ? { refresh: current.lastActivityAt } : {}),
          ...(current.tokens ? { tokens: current.tokens } : {}),
          ...(current.price ? { price: current.price } : {}),
        }
      : selectedSession
        ? {
            sessionId: selectedSession.sessionId,
            ...(selectedSession.title ? { title: selectedSession.title } : {}),
            ...(selectedSession.price ? { price: selectedSession.price } : {}),
          }
        : undefined;

  const modes: Mode[] = [
    {
      id: "plan",
      icon: ClipboardList,
      title: "Plan",
      about: t("Le plan soumis en sortant du mode plan, avec sa progression s'il porte des cases."),
      render: () => (shown ? <PlanPanel session={shown} /> : null),
    },
    {
      id: "activity",
      icon: Activity,
      title: t("Activité"),
      about: t("Le déroulé de la session : prompts, réponses et appels d'outils."),
      render: () => (shown ? <ActivityPanel session={shown} /> : null),
    },
    {
      id: "captures",
      icon: Images,
      title: t("Captures"),
      about: t("Les images de la session, sous-agents compris : captures prises par Claude, images collées."),
      render: () => (shown ? <CapturesPanel session={shown} /> : null),
    },
    {
      id: "files",
      icon: FileDiff,
      title: t("Fichiers"),
      about: t(
        "Ce que la session a changé, avec le diff exact. L'état « avant » vient des sauvegardes de Claude Code, pas de git.",
      ),
      render: () =>
        shown ? (
          <FilesPanel session={shown} />
        ) : (
          <p className="py-6 text-center text-muted-foreground">
            {t("Lance Claude dans un onglet, ou choisis une session dans History.")}
          </p>
        ),
    },
    {
      id: "diagram",
      icon: Workflow,
      title: t("Schéma"),
      about: t("Un diagramme de ce que la session a changé, rédigé à la demande par claude -p : il coûte des tokens."),
      render: () => (shown ? <DiagramPanel session={shown} /> : null),
    },
  ];

  return (
    <Island>
      <div className="flex shrink-0 items-center gap-1.5 px-2 py-1.5">
        <nav className="flex flex-1 gap-1 overflow-x-auto [scrollbar-width:none]">
          {own.map(({ info }) => (
            <div
              key={info.id}
              onClick={() => focusTerminal(info.id)}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1 transition-colors",
                info.id === activeTerminalId
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
          ))}
        </nav>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={!project}
          onClick={() => openTerminal("shell")}
          title={t("Nouveau shell")}
        >
          <Plus />
        </Button>
        <CaptureButton terminalId={status?.id} />
        <Button
          variant="ghost"
          size="icon"
          className={cn("size-7", previewOpen && "bg-accent", serving && !previewOpen && "text-primary")}
          disabled={!project}
          onClick={() => setState({ previewOpen: !previewOpen })}
          title={serving ? t("Aperçu du serveur de développement") : t("Aperçu : aucun serveur de développement ne tourne")}
        >
          <MonitorPlay />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-primary"
          disabled={!project}
          onClick={() => openTerminal("claude", { command: "claude" })}
        >
          <Sparkles /> claude
        </Button>
      </div>

      <div className="mx-2 flex min-h-0 flex-1 gap-1">
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border bg-[var(--term-bg)]">
          {own.length === 0 && <Welcome root={project?.root} />}
          {Object.values(terminals).map(({ info }) => (
            <TerminalHost key={info.id} info={info} active={info.id === activeTerminalId} />
          ))}
        </div>
        {previewOpen && project && <DevPreview terminals={own.map((entry) => entry.info)} />}
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
              formatSessionCost(current?.price) ?? "",
            ]
              .filter(Boolean)
              .join("   ·   ")
          : ""}
      </footer>

      {status?.kind === "claude" && current && <QueueStrip queue={current.queue ?? []} />}

      <ModeBlock
        modes={modes}
        current={sessionMode}
        onPick={(id) => setState({ sessionMode: id })}
        header={shown?.title}
        collapsed={sessionCollapsed}
        onCollapse={(value) => setState({ sessionCollapsed: value })}
        className="max-h-[38%]"
      />
    </Island>
  );
}
