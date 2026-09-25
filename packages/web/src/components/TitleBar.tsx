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
  Settings2,
  SquareDashed,
  Sun,
  X,
} from "lucide-react";
import { useState } from "react";

import { BranchDialog } from "@/components/BranchDialog";
import { FolderInput } from "@/components/FolderInput";
import { GitChip } from "@/components/GitChip";
import { PullReportDialog, pullRepositories, usePullRunning } from "@/components/GitSync";
import { PreferencesDialog } from "@/components/Preferences";
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
import { openDoc } from "@/lib/api";
import { closeProject, openProject, setState, useStore } from "@/state/store";
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
  const preferences = useStore((state) => state.preferencesOpen);
  const setPreferences = (value: boolean) => setState({ preferencesOpen: value });
  const [draft, setDraft] = useState("");
  const [branching, setBranching] = useState<string>();
  const pulling = usePullRunning();

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

  return (
    <header className="flex shrink-0 items-center gap-1.5 px-1.5 py-1.5">
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

      <nav className="flex flex-1 justify-center gap-1 overflow-x-auto [scrollbar-width:none]">
        {projects.map((project) => {
          const waiting = Object.entries(terminals).filter(
            ([id, entry]) => entry.owner === project.root && attention[id],
          ).length;
          const active = project.root === activeRoot;
          return (
            <ContextMenu key={project.root}>
              <ContextMenuTrigger asChild>
                <div
                  title={project.root}
                  onClick={() => setState({ activeRoot: project.root })}
                  className={cn(
                    "group flex max-w-64 cursor-pointer items-center gap-2 rounded-full border px-3 py-1 transition-colors",
                    active
                      ? "border-border bg-card text-foreground shadow-sm"
                      : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <SquareDashed className="size-3.5 shrink-0" />
                  <span className="truncate">{project.name}</span>
                  {waiting > 0 && (
                    <Badge className="h-4 min-w-4 justify-center rounded-full px-1 text-[10px] tabular-nums">
                      {waiting}
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

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="size-7" onClick={() => setPreferences(true)}>
            <Settings2 />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("Préférences")}</TooltipContent>
      </Tooltip>
      <PreferencesDialog open={preferences} onOpenChange={setPreferences} />

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
    </header>
  );
}
