import { Contrast, Moon, PanelLeft, PanelRight, Plus, SquareDashed, Sun, X } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { closeProject, openProject, setState, useStore } from "@/state/store";
import { cycleTheme } from "@/state/theme";
import { closeTerminal } from "@/state/terminals";

const THEME_ICON = { auto: Contrast, light: Sun, dark: Moon };
const THEME_LABEL = { auto: "Thème : système", light: "Thème : clair", dark: "Thème : sombre" };

export function TitleBar() {
  const { projects, activeRoot, connected, theme, showLeft, showRight, terminals, attention } = useStore(
    (state) => state,
  );
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const ThemeIcon = THEME_ICON[theme];

  /** Un projet part avec ses terminaux : sans onglet, ils seraient inatteignables. */
  const close = (root: string) => {
    for (const [id, entry] of Object.entries(terminals)) {
      if (entry.owner === root) closeTerminal(id);
    }
    closeProject(root);
  };

  const confirm = () => {
    if (draft.trim()) openProject(draft);
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
        <TooltipContent>Colonne du projet</TooltipContent>
      </Tooltip>

      <nav className="flex flex-1 justify-center gap-1 overflow-x-auto [scrollbar-width:none]">
        {projects.map((project) => {
          const waiting = Object.entries(terminals).filter(
            ([id, entry]) => entry.owner === project.root && attention[id],
          ).length;
          const active = project.root === activeRoot;
          return (
            <div
              key={project.root}
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
          );
        })}
      </nav>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="size-7" onClick={() => setAdding(true)}>
            <Plus />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Ouvrir un projet</TooltipContent>
      </Tooltip>

      <span
        className={cn("ml-auto text-[11px]", connected ? "text-muted-foreground" : "text-destructive")}
      >
        {connected ? "connecté" : "déconnecté…"}
      </span>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="size-7" onClick={cycleTheme}>
            <ThemeIcon />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{THEME_LABEL[theme]}</TooltipContent>
      </Tooltip>

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
        <TooltipContent>Panneau global</TooltipContent>
      </Tooltip>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Ouvrir un projet</DialogTitle>
            <DialogDescription>
              Le dossier racine du dépôt. Ses terminaux, ses fichiers et ses réglages en dépendent.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            spellCheck={false}
            placeholder="C:\Projets\mon-projet"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && confirm()}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              Annuler
            </Button>
            <Button onClick={confirm}>Ouvrir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  );
}
