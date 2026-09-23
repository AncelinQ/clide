import {
  Bell,
  Coins,
  Cpu,
  History,
  Layers,
  MoreHorizontal,
  Plug,
  Search,
  Settings,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { t } from "@/i18n";
import { setState, useStore, type TabLayout } from "@/state/store";
import { cn } from "cn";

export const GLOBAL_TABS: { id: string; icon: LucideIcon; label: string }[] = [
  { id: "processes", icon: Cpu, label: "Process" },
  { id: "history", icon: History, label: "History" },
  { id: "search", icon: Search, label: "Recherche" },
  { id: "chantiers", icon: Layers, label: "Chantiers" },
  { id: "skills", icon: Sparkles, label: "Skills" },
  { id: "mcp", icon: Plug, label: "MCP" },
  { id: "costs", icon: Coins, label: "Coûts" },
  { id: "settings", icon: Settings, label: "Réglages" },
  { id: "notifications", icon: Bell, label: "Alertes" },
];

/** Largeur d'un onglet de la ligne, et du bouton « ⋯ », en pixels. */
const TAB_WIDTH = 54;
const MENU_WIDTH = 34;

/** Onglets choisis pour la ligne ou la colonne, dans l'ordre de la liste ; tous par défaut. */
function useShownTabs() {
  const visible = useStore((state) => state.visibleTabs);
  return GLOBAL_TABS.filter((tab) => !visible || visible.includes(tab.id));
}

function TabButton({
  tab,
  current,
  vertical,
}: {
  tab: (typeof GLOBAL_TABS)[number];
  current: string;
  vertical?: boolean;
}) {
  return (
    <button
      type="button"
      data-tab={tab.id}
      onClick={() => setState({ globalTab: tab.id, showRight: true })}
      title={vertical ? t(tab.label) : undefined}
      className={cn(
        "flex shrink-0 flex-col items-center gap-1 rounded-lg border py-1.5 text-[10px] whitespace-nowrap transition-colors",
        vertical ? "w-12 px-0.5" : "px-1.5",
        tab.id === current
          ? "border-primary bg-primary text-primary-foreground"
          : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
      style={vertical ? undefined : { width: TAB_WIDTH }}
    >
      <tab.icon className="size-4" />
      <span className="max-w-full truncate">{t(tab.label)}</span>
    </button>
  );
}

/**
 * Menu « ⋯ » des onglets, comme celui des outils de développement du navigateur :
 * les onglets qui ne tiennent pas, puis le choix de ceux qui s'affichent et de la
 * disposition. Masquer un onglet ne le rend pas inaccessible : il reste dans ce
 * menu.
 */
function TabMenu({ current, overflow }: { current: string; overflow: typeof GLOBAL_TABS }) {
  const visible = useStore((state) => state.visibleTabs);
  const layout = useStore((state) => state.tabLayout);
  const shown = new Set(visible ?? GLOBAL_TABS.map((tab) => tab.id));

  const toggle = (id: string, on: boolean) => {
    const next = GLOBAL_TABS.map((tab) => tab.id).filter((tabId) => (tabId === id ? on : shown.has(tabId)));
    // Tout masquer ne laisserait rien à cliquer hors du menu : on garde au moins un onglet.
    if (next.length === 0) return;
    setState({ visibleTabs: next.length === GLOBAL_TABS.length ? null : next });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8 shrink-0" title={t("Onglets")}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {overflow.length > 0 && (
          <>
            {overflow.map((tab) => (
              <DropdownMenuItem key={tab.id} onSelect={() => setState({ globalTab: tab.id, showRight: true })}>
                <tab.icon />
                <span className={cn(tab.id === current && "font-medium text-primary")}>{t(tab.label)}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        )}
        {/* En sous-menu, comme « Plus d'outils » des DevTools : la liste complète
            allongerait le menu au point de le faire défiler. */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{t("Onglets affichés")}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {GLOBAL_TABS.map((tab) => (
              <DropdownMenuCheckboxItem
                key={tab.id}
                checked={shown.has(tab.id)}
                // Le menu reste ouvert : on coche souvent plusieurs onglets à la suite.
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={(on) => toggle(tab.id, on === true)}
              >
                {t(tab.label)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[11px] text-muted-foreground">{t("Disposition")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={layout} onValueChange={(value) => setState({ tabLayout: value as TabLayout })}>
          <DropdownMenuRadioItem value="row">{t("En ligne, en haut")}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="column">{t("En colonne, à droite")}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Onglets en ligne : autant qu'en tient la largeur, le reste dans « ⋯ ».
 *
 * L'onglet ouvert reste toujours sur la ligne — il prend la dernière place s'il
 * n'en avait pas —, pour qu'on voie où l'on est.
 */
export function TabRow({ current }: { current: string }) {
  const nav = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(0);
  const shown = useShownTabs();

  useEffect(() => {
    const element = nav.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const capacity = Math.max(1, Math.floor((width - MENU_WIDTH) / (TAB_WIDTH + 2)));
  let inline = shown.slice(0, capacity);
  const active = GLOBAL_TABS.find((tab) => tab.id === current);
  if (active && !inline.includes(active)) inline = [...inline.slice(0, Math.max(0, capacity - 1)), active];
  const overflow = GLOBAL_TABS.filter((tab) => !inline.includes(tab));

  return (
    <nav ref={nav} className="flex shrink-0 items-center gap-0.5 border-b px-1.5 py-2">
      <div className="flex min-w-0 flex-1 justify-around gap-0.5">
        {width > 0 && inline.map((tab) => <TabButton key={tab.id} tab={tab} current={current} />)}
      </div>
      <TabMenu current={current} overflow={overflow} />
    </nav>
  );
}

/**
 * Onglets en colonne sur le bord droit, comme les barres d'outils de WebStorm :
 * la hauteur tient tous les onglets, et le panneau garde toute sa largeur de
 * texte.
 */
export function TabRail({ current }: { current: string }) {
  const shown = useShownTabs();
  const hidden = GLOBAL_TABS.filter((tab) => !shown.includes(tab));
  return (
    <nav className="flex shrink-0 flex-col items-center gap-0.5 border-l px-1 py-2">
      {shown.map((tab) => (
        <TabButton key={tab.id} tab={tab} current={current} vertical />
      ))}
      <div className="flex-1" />
      <TabMenu current={current} overflow={hidden} />
    </nav>
  );
}
