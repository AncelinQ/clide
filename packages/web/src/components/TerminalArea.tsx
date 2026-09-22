import { Activity, ClipboardList, FileDiff, Plus, Sparkles, Terminal as TerminalIcon, X } from "lucide-react";
import { useEffect, useRef } from "react";

import { Island } from "@/components/columns";
import { ModeBlock, type Mode } from "@/components/ModeBlock";
import { ActivityPanel, FilesPanel, PlanPanel } from "@/components/panels/session";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import { activeProject, setState, useStore } from "@/state/store";
import { terminalTheme } from "@/state/theme";
import { closeTerminal, focusTerminal, mount, openTerminal, resize, typeInto } from "@/state/terminals";
import type { TerminalInfo } from "@/lib/types";

/** Accueil affiché tant qu'aucun terminal n'est ouvert pour ce projet. */
function Welcome({ root }: { root?: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="grid size-16 place-items-center rounded-full bg-accent text-primary">
        <Sparkles className="size-7" />
      </div>
      <h2 className="text-[15px] font-semibold">{root ? "Aucun terminal" : "Aucun projet ouvert"}</h2>
      <p className="font-mono text-[11px] text-muted-foreground">
        {root ?? "Ouvre un projet pour commencer."}
      </p>
      {root && (
        <div className="mt-1 flex gap-2">
          <Button onClick={() => openTerminal("claude", { command: "claude" })}>
            <Sparkles /> Démarrer Claude
          </Button>
          <Button variant="outline" onClick={() => openTerminal("shell")}>
            <TerminalIcon /> Shell
          </Button>
        </div>
      )}
    </div>
  );
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
      onDragOver={desktop ? (event) => event.preventDefault() : undefined}
      onDrop={
        desktop
          ? (event) => {
              // Le chemin d'un fichier déposé n'est connu que sous Electron :
              // un navigateur livre son contenu, jamais son emplacement.
              event.preventDefault();
              const paths = [...event.dataTransfer.files]
                .map((file) => desktop.pathForFile(file))
                .filter((path): path is string => Boolean(path))
                .map((path) => (path.includes(" ") ? `"${path}"` : path));
              if (paths.length > 0) typeInto(info.id, `${paths.join(" ")} `);
            }
          : undefined
      }
    />
  );
}

export function TerminalArea() {
  const { terminals, activeTerminalId, attention, activeRoot, selectedSession, sessionMode } = useStore(
    (state) => state,
  );
  const project = useStore(activeProject);
  const own = Object.values(terminals).filter((entry) => entry.owner === activeRoot);
  const active = activeTerminalId ? terminals[activeTerminalId] : undefined;
  const status = active && active.owner === activeRoot ? active.info : undefined;

  const modes: Mode[] = [
    {
      id: "plan",
      icon: ClipboardList,
      title: "Plan",
      about: "Le plan soumis en sortant du mode plan, avec sa progression s'il porte des cases.",
      render: () => (selectedSession ? <PlanPanel session={selectedSession} /> : null),
    },
    {
      id: "activity",
      icon: Activity,
      title: "Activité",
      about: "Le déroulé de la session : prompts, réponses et appels d'outils.",
      render: () => (selectedSession ? <ActivityPanel session={selectedSession} /> : null),
    },
    {
      id: "files",
      icon: FileDiff,
      title: "Fichiers",
      about:
        "Ce que la session a changé, avec le diff exact. L'état « avant » vient des sauvegardes de Claude Code, pas de git.",
      render: () =>
        selectedSession ? (
          <FilesPanel session={selectedSession} />
        ) : (
          <p className="py-6 text-center text-muted-foreground">
            Choisis une session dans History, à droite.
          </p>
        ),
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
          title="Nouveau shell"
        >
          <Plus />
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

      <div className="relative mx-2 min-h-0 flex-1 overflow-hidden rounded-lg border bg-[var(--term-bg)]">
        {own.length === 0 && <Welcome root={project?.root} />}
        {Object.values(terminals).map(({ info }) => (
          <TerminalHost key={info.id} info={info} active={info.id === activeTerminalId} />
        ))}
      </div>

      <footer className="shrink-0 overflow-x-auto px-3 py-1.5 text-[11px] whitespace-nowrap text-muted-foreground [scrollbar-width:none]">
        {status
          ? [status.cwd, status.kind, status.state, status.lastExitCode !== undefined ? `sortie ${status.lastExitCode}` : ""]
              .filter(Boolean)
              .join("   ·   ")
          : ""}
      </footer>

      <ModeBlock
        modes={modes}
        current={sessionMode}
        onPick={(id) => setState({ sessionMode: id })}
        header={selectedSession?.title}
        className="max-h-[38%]"
      />
    </Island>
  );
}
