import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "cn";

export interface Activity {
  id: string;
  icon: LucideIcon;
  label: string;
}

/**
 * Colonne d'icônes au bord de la fenêtre, comme celles de VS Code et des IDE
 * JetBrains : chacune ouvre sa vue dans la colonne voisine, et cliquer celle qui
 * est ouverte replie la colonne. La barre reste visible colonne repliée : c'est
 * par elle qu'on la rouvre.
 */
export function ActivityBar({
  activities,
  current,
  open,
  onPick,
  onToggle,
  side,
  footer,
}: {
  activities: Activity[];
  current: string;
  open: boolean;
  onPick: (id: string) => void;
  onToggle: (open: boolean) => void;
  side: "left" | "right";
  footer?: ReactNode;
}) {
  return (
    <nav
      aria-label={side === "left" ? "Projet" : "Global"}
      className="on-canvas flex w-10 shrink-0 flex-col items-center gap-1 overflow-y-auto py-1 [scrollbar-width:none]"
    >
      {activities.map((activity) => {
        const active = open && activity.id === current;
        return (
          <Tooltip key={activity.id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-activity={activity.id}
                aria-pressed={active}
                aria-label={activity.label}
                onClick={() => {
                  if (active) onToggle(false);
                  else {
                    onPick(activity.id);
                    onToggle(true);
                  }
                }}
                className={cn(
                  "flex size-8 items-center justify-center rounded-lg transition-colors",
                  active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <activity.icon className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side={side === "left" ? "right" : "left"}>{activity.label}</TooltipContent>
          </Tooltip>
        );
      })}
      <div className="flex-1" />
      {footer}
    </nav>
  );
}
