import { ChevronDown, ChevronUp, Info, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "cn";

export interface Mode {
  id: string;
  icon: LucideIcon;
  title: string;
  about: string;
  render: () => ReactNode;
}

/**
 * Bloc à modes : les icônes à gauche, `ⓘ` qui explique le mode courant et un
 * chevron qui replie. Le même motif sert dans la colonne du projet et sous le
 * terminal — c'est ce qui les fait lire comme deux instances d'une même chose.
 */
export function ModeBlock({
  modes,
  current,
  onPick,
  header,
  className,
  collapsed: controlled,
  onCollapse,
}: {
  modes: Mode[];
  current: string;
  onPick: (id: string) => void;
  header?: ReactNode;
  className?: string;
  /** Repli piloté de l'extérieur, pour qu'une commande puisse le basculer. */
  collapsed?: boolean;
  onCollapse?: (collapsed: boolean) => void;
}) {
  const [about, setAbout] = useState(false);
  const [local, setLocal] = useState(false);
  const collapsed = controlled ?? local;
  const setCollapsed = (update: (value: boolean) => boolean) => {
    const next = update(collapsed);
    if (onCollapse) onCollapse(next);
    else setLocal(next);
  };
  const mode = modes.find((entry) => entry.id === current) ?? modes[0];
  if (!mode) return null;

  return (
    <div className={cn("flex min-h-0 shrink-0 flex-col border-t", collapsed ? "" : "flex-1", className)}>
      <div className="flex shrink-0 items-center gap-0.5 px-2 py-1.5">
        {modes.map((entry) => (
          <Tooltip key={entry.id}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn("size-7", entry.id === current && "bg-accent text-primary")}
                onClick={() => onPick(entry.id)}
              >
                <entry.icon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{entry.title}</TooltipContent>
          </Tooltip>
        ))}

        <div className="flex-1 truncate px-2 text-[11px] text-muted-foreground">{header}</div>

        <Button
          variant="ghost"
          size="icon"
          className={cn("size-7", about && "bg-accent text-primary")}
          onClick={() => setAbout((value) => !value)}
          title="À quoi sert ce mode"
        >
          <Info />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => setCollapsed((value) => !value)}
          title={collapsed ? "Déplier" : "Replier"}
        >
          {collapsed ? <ChevronUp /> : <ChevronDown />}
        </Button>
      </div>

      {!collapsed && (
        <ScrollArea className="min-h-0 flex-1">
          <div className="px-3 pb-3">
            {about && <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">{mode.about}</p>}
            {mode.render()}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
