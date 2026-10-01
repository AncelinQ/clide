import {
  BookOpen,
  CloudDownload,
  Contrast,
  GitBranch,
  LoaderCircle,
  Moon,
  PanelLeft,
  PanelRight,
  Plus,
  SquareDashed,
  Sun,
  X,
} from "lucide-react";
import { useState } from "react";

import { BranchDialog } from "@/components/BranchDialog";
import { Reorderable } from "@/components/Reorderable";
import { FolderInput } from "@/components/FolderInput";
import { useAsync } from "@/components/common";
import { GitChip, RepoMarks } from "@/components/GitChip";
import { PullReportDialog, pullRepositories, usePullRunning } from "@/components/GitSync";
import { SettingsDialog } from "@/components/Preferences";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "cn";
import { t } from "@/i18n";
import { api, openDoc } from "@/lib/api";
import { dropTab } from "@/lib/tab-order";
import { recentProjects } from "@/lib/recents";
import type { SessionSummary } from "@/lib/types";
import { activateProject, closeProject, openProject, setState, useStore } from "@/state/store";
import { cycleTheme } from "@/state/theme";
import { closeTerminal } from "@/state/terminals";

const THEME_ICON = { auto: Contrast, light: Sun, dark: Moon };
const THEME_LABEL = { auto: "Thème : système", light: "Thème : clair", dark: "Thème : sombre" };

export function TitleBar() {
  const { projects, activeRoot, connected, theme, showLeft, showRight, terminals, attention } = useStore(
    (state) => state,
  );
  const adding = useStore((state) => state.addingProject);
  const setAdding = (value: boolean) => setState({ addingProject: value });
  // Ranger les projets, c'est réordonner leur liste : c'est elle qui est sauvegardée.
  const dropProject = (moved: string, target: string, side: "before" | "after") =>
    setState((current) => {
      const order = dropTab(current.projects.map((project) => project.root), moved, target, side);
      return { projects: order.map((root) => current.projects.find((project) => project.root === root)).filter((project) => project !== undefined) };
    });
  const [draft, setDraft] = useState("");
  const [branching, setBranching] = useState<string>();
  const pulling = usePullRunning();
  // Les dossiers où des sessions ont tourné, du plus récent au plus ancien : ce
  // sont les projets qu'on rouvre. Lus à l'ouverture de la fenêtre seulement.
  const known = useAsync(
    () => (adding ? api<{ sessions: SessionSummary[] }>("/api/sessions") : Promise.resolve({ sessions: [] })),
    [adding],
  );
  const recents = recentProjects(known.data?.sessions ?? [], projects.map((project) => project.root));

  const ThemeIcon = THEME_ICON[theme];

  /** Un projet part avec ses terminaux : sans onglet, ils seraient inatteignables. */
  const close = (root: string) => {
    for (const [id, entry] of Object.entries(terminals)) {
      if (entry.owner === root) closeTerminal(id);
    }
    closeProject(root);
  };

  const confirm = (path = draft) => {
    if (path.trim()) openProject(path.trim());
    setDraft("");
    setAdding(false);
  };

  // Deux côtés de même largeur : les projets restent au centre de la barre, quelle
  // que soit la largeur de la puce git.
  return (
    <header className="on-canvas grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-1.5 px-1.5 py-1.5">
      <div className="flex min-w-0 items-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setState({ showLeft: !showLeft })}
            >
              <PanelLeft />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("Colonne du projet")}</TooltipContent>
        </Tooltip>
      </div>

      <div className="flex min-w-0 items-center gap-1.5">
        <nav className="flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:none]">
          {projects.map((project) => {
            const waiting = Object.entries(terminals).filter(
              ([id, entry]) => entry.owner === project.root && attention[id],
            ).length;
            const busy = Object.values(terminals).filter(
              (entry) =>
                entry.owner === project.root &&
                entry.info.kind === "claude" &&
                entry.info.state === "running" &&
                !entry.info.exited,
            ).length;
            const active = project.root === activeRoot;
            return (
              <Reorderable key={project.root} group="projects" id={project.root} onDrop={dropProject}>
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <div
                      title={project.root}
                      onClick={() => activateProject(project.root)}
                      className={cn(
                        "group flex max-w-64 cursor-pointer items-center gap-2 rounded-full border px-3 py-1 transition-colors",
                        active
                          ? "border-border bg-card text-foreground shadow-sm"
                          : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      <SquareDashed className="size-3.5 shrink-0" />
                      <span className="truncate">{project.name}</span>
                      <RepoMarks root={project.root} />
                      {waiting > 0 && (
                        <Badge className="h-4 min-w-4 justify-center rounded-full px-1 text-[10px] tabular-nums">
                          {waiting}
                        </Badge>
                      )}
                      {busy > 0 && (
                        <Badge
                          variant="outline"
                          className="h-4 min-w-4 justify-center rounded-full border-emerald-500/60 px-1 text-[10px] text-emerald-600 tabular-nums dark:text-emerald-400"
                          title={t("{count} Claude en cours", { count: busy })}
                        >
                          {busy}
                        </Badge>
                      )}
                      <X
                        className="size-3.5 shrink-0 rounded-full opacity-50 hover:bg-accent hover:opacity-100"
                        onClick={(event) => {
                          event.stopPropagation();
                          close(project.root);
                        }}
                      />
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem
                      disabled={pulling}
                      onSelect={() => void pullRepositories([project.root], { label: t("Mettre à jour {name}", { name: project.name }) })}
                    >
                      <CloudDownload /> {t("Mettre à jour (git pull)")}
                    </ContextMenuItem>
                    <ContextMenuItem
                      disabled={pulling}
                      onSelect={() =>
                        void pullRepositories([project.root], {
                          withLinks: true,
                          label: t("Mettre à jour {name} et ses dossiers liés", { name: project.name }),
                        })
                      }
                    >
                      <CloudDownload /> {t("Mettre à jour avec les dossiers liés")}
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => setBranching(project.root)}>
                      <GitBranch /> {t("Changer de branche…")}
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onSelect={() => close(project.root)}>
                      <X /> {t("Fermer le projet")}
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              </Reorderable>
            );
          })}
        </nav>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7" onClick={() => setAdding(true)}>
              <Plus />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("Ouvrir un projet")}</TooltipContent>
        </Tooltip>

        {projects.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                disabled={pulling}
                onClick={() =>
                  void pullRepositories(
                    projects.map((project) => project.root),
                    { withLinks: true, label: t("Mettre à jour tous les projets") },
                  )
                }
              >
                {pulling ? <LoaderCircle className="animate-spin" /> : <CloudDownload />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("Mettre à jour les projets ouverts et leurs dossiers liés (git pull)")}</TooltipContent>
          </Tooltip>
        )}
      </div>

      <div className="flex min-w-0 items-center gap-1.5">
        {activeRoot && <GitChip key={activeRoot} root={activeRoot} />}

        <span
          className={cn("ml-auto text-[11px]", connected ? "text-muted-foreground" : "text-destructive")}
        >
          {connected ? t("connecté") : t("déconnecté…")}
        </span>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7" onClick={() => openDoc()}>
              <BookOpen />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("Documentation")}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7" onClick={cycleTheme}>
              <ThemeIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t(THEME_LABEL[theme])}</TooltipContent>
        </Tooltip>

        <SettingsDialog />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setState({ showRight: !showRight })}
            >
              <PanelRight />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("Panneau global")}</TooltipContent>
        </Tooltip>

        <Dialog open={adding} onOpenChange={setAdding}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{t("Ouvrir un projet")}</DialogTitle>
              <DialogDescription>
                {t("Le dossier racine du dépôt. Ses terminaux, ses fichiers et ses réglages en dépendent.")}
              </DialogDescription>
            </DialogHeader>
            {/* Un dossier choisi dans la fenêtre s'ouvre aussitôt : le choisir, c'est déjà confirmer. */}
            <FolderInput
              autoFocus
              title={t("Ouvrir un projet")}
              placeholder={t("C:\\Projets\\mon-projet")}
              value={draft}
              onChange={setDraft}
              onPicked={confirm}
              onKeyDown={(event) => event.key === "Enter" && confirm()}
            />
            {recents.length > 0 && (
              <div className="grid grid-cols-1 gap-0.5">
                <span className="px-2 text-[11px] text-muted-foreground">{t("Récents")}</span>
                {recents.map(({ root, sessions }) => (
                  <button
                    key={root}
                    type="button"
                    className="flex items-baseline gap-2 rounded-md px-2 py-1 text-left hover:bg-accent"
                    onClick={() => confirm(root)}
                  >
                    <span className="shrink-0 font-medium">{root.split(/[\\/]/).pop()}</span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{root}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                      {t(sessions === 1 ? "{count} session" : "{count} sessions", { count: sessions })}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setAdding(false)}>
                {t("Annuler")}
              </Button>
              <Button onClick={() => confirm()}>{t("Ouvrir")}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <PullReportDialog />
        {branching && (
          <BranchDialog
            root={branching}
            onClose={() => setBranching(undefined)}
            onDone={() => setBranching(undefined)}
          />
        )}
      </div>
    </header>
  );
}
