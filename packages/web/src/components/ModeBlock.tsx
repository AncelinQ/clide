import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  ChevronDown,
  ChevronUp,
  Info,
  MoreHorizontal,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "cn";
import { t } from "@/i18n";
import { docUrl } from "@/lib/api";
import { setState, useStore } from "@/state/store";

export interface Mode {
  id: string;
  icon: LucideIcon;
  title: string;
  about: string;
  /** Section du guide qui détaille le mode : `session#captures`. */
  doc?: string;
  /**
   * Le mode liste des éléments datés, qu'on peut montrer les plus récents en
   * haut ; la valeur nomme l'ordre par défaut, pour le bouton qui y revient.
   */
  defaultOrder?: string;
  render: () => ReactNode;
}

/**
 * Menu « ⋯ » d'un bloc à modes, comme celui du panneau global : les modes
 * masqués, qui y restent accessibles, puis le choix de ceux qui s'affichent.
 */
function ModeMenu({
  block,
  modes,
  current,
  onPick,
}: {
  block: string;
  modes: Mode[];
  current: string;
  onPick: (id: string) => void;
}) {
  const hidden = new Set(useStore((state) => state.hiddenModes[block]) ?? []);
  const off = modes.filter((mode) => hidden.has(mode.id));

  const toggle = (id: string, on: boolean) => {
    const next = modes.map((mode) => mode.id).filter((modeId) => (modeId === id ? !on : hidden.has(modeId)));
    // Tout masquer ne laisserait rien à cliquer hors du menu : on garde au moins un mode.
    if (next.length === modes.length) return;
    setState((state) => ({ hiddenModes: { ...state.hiddenModes, [block]: next } }));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-7" title={t("Onglets")}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {off.length > 0 && (
          <>
            {off.map((mode) => (
              <DropdownMenuItem key={mode.id} onSelect={() => onPick(mode.id)}>
                <mode.icon />
                <span className={cn(mode.id === current && "font-medium text-primary")}>{mode.title}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{t("Onglets affichés")}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {modes.map((mode) => (
              <DropdownMenuCheckboxItem
                key={mode.id}
                checked={!hidden.has(mode.id)}
                // Le menu reste ouvert : on coche souvent plusieurs onglets à la suite.
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={(on) => toggle(mode.id, on === true)}
              >
                <mode.icon /> {mode.title}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Retient, pour un mode, si ses éléments les plus récents viennent en haut. */
export function useNewestFirst(mode: string): boolean {
  return useStore((state) => state.newestFirst[mode] === true);
}

function OrderButton({ mode, defaultOrder }: { mode: string; defaultOrder: string }) {
  const newest = useNewestFirst(mode);
  const Icon = newest ? ArrowDownWideNarrow : ArrowUpNarrowWide;
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("size-7", newest && "bg-accent text-primary")}
      onClick={() => setState((state) => ({ newestFirst: { ...state.newestFirst, [mode]: !newest } }))}
      title={
        newest
          ? t("Plus récents en haut — revenir à : {order}", { order: defaultOrder })
          : t("Mettre les plus récents en haut")
      }
    >
      <Icon />
    </Button>
  );
}

/**
 * Bloc à modes : les icônes à gauche, `ⓘ` qui explique le mode courant et un
 * chevron qui replie. Le même motif sert dans la colonne du projet et sous le
 * terminal — c'est ce qui les fait lire comme deux instances d'une même chose.
 */
export function ModeBlock({
  block,
  modes,
  current,
  onPick,
  header,
  className,
  collapsed: controlled,
  onCollapse,
}: {
  /** Clé sous laquelle les modes masqués du bloc sont retenus. */
  block: string;
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
  const hidden = useStore((state) => state.hiddenModes[block]);
  const mode = modes.find((entry) => entry.id === current) ?? modes[0];
  if (!mode) return null;
  // Le mode ouvert garde son icône même masqué, pour qu'on voie où l'on est.
  const shown = modes.filter((entry) => !hidden?.includes(entry.id) || entry.id === mode.id);

  return (
    <div className={cn("flex min-h-0 shrink-0 flex-col border-t", collapsed ? "" : "flex-1", className)}>
      <div className="flex shrink-0 items-center gap-0.5 px-2 py-1.5">
        {shown.map((entry) => (
          <Tooltip key={entry.id}>
            <TooltipTrigger asChild>
              <Button
                aria-label={entry.title}
                data-mode={entry.id}
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

        {mode.defaultOrder && <OrderButton mode={mode.id} defaultOrder={mode.defaultOrder} />}
        <ModeMenu block={block} modes={modes} current={mode.id} onPick={onPick} />
        <Button
          variant="ghost"
          size="icon"
          className={cn("size-7", about && "bg-accent text-primary")}
          onClick={() => setAbout((value) => !value)}
          title={t("À quoi sert ce mode")}
        >
          <Info />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => setCollapsed((value) => !value)}
          title={collapsed ? t("Déplier") : t("Replier")}
        >
          {collapsed ? <ChevronUp /> : <ChevronDown />}
        </Button>
      </div>

      {!collapsed && (
        <ScrollArea className="min-h-0 flex-1">
          <div className="px-3 pb-3">
            {about && (
              <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
                {mode.about}
                {mode.doc && (
                  <>
                    {" "}
                    <a
                      href={docUrl(mode.doc)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      {t("En savoir plus")}
                    </a>
                  </>
                )}
              </p>
            )}
            {mode.render()}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
