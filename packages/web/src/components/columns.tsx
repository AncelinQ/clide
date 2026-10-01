import { FolderGit2, FolderTree, History, Info, Plug, RefreshCw, Search, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { FileTree } from "@/components/FileTree";
import type { Activity } from "@/components/ActivityBar";
import { Splitter, clamp } from "@/components/Splitter";
import { TabRow } from "@/components/GlobalTabs";
import { ChantiersPanel } from "@/components/panels/chantiers";
import { SearchPanel } from "@/components/panels/search";
import {
  LinksPanel,
  ProjectMcpPanel,
  ProjectSkillsPanel,
  WorktreesPanel,
} from "@/components/panels/project";
import {
  HistoryPanel,
  NotificationsPanel,
  ProcessesPanel,
  UserMcpPanel,
  UserSkillsPanel,
} from "@/components/panels/global";
import { FileSearchPanel } from "@/components/panels/file-search";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "cn";
import { t } from "@/i18n";
import { docUrl } from "@/lib/api";
import { moduleGlobalViews, moduleProjectViews } from "@/modules";
import { activeProject, setState, useStore, type Project } from "@/state/store";

/** Coquille commune des trois colonnes : un îlot posé sur la toile. */
export function Island({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-card shadow-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}

// ─── Colonne du projet ──────────────────────────────────────────────────────

type ProjectActivity = Activity & { about: string; doc?: string; render?: (root: string) => React.ReactNode };

/** Vues de la colonne du projet, dans l'ordre de sa barre d'activité : celles de l'application, celles des modules actifs après l'historique. */
export function projectActivities(disabledModules: readonly string[]): ProjectActivity[] {
  const fromModules: ProjectActivity[] = moduleProjectViews(disabledModules).map((view) => ({
    id: view.id,
    icon: view.icon,
    label: t(view.label),
    about: t(view.about),
    ...(view.doc ? { doc: view.doc } : {}),
    render: view.render,
  }));
  const core: ProjectActivity[] = [
    {
      id: "explorer",
      icon: FolderTree,
      label: t("Explorateur"),
      doc: "projet#dossiers-lies",
      about: t(
        "Les fichiers du projet, puis les autres projets dont celui-ci dépend. Leurs chemins vont dans .claude/settings.local.json, qui en donne l'accès à Claude ; leurs rôles vont dans un fichier de prompt que chaque session reçoit, qui lui dit à quoi ils servent.",
      ),
    },
    {
      id: "search",
      icon: Search,
      label: t("Recherche"),
      doc: "projet#rechercher-dans-les-fichiers",
      about: t(
        "Un texte ou une expression dans les fichiers du projet, hors dépendances et sorties de build, groupés par fichier. Un clic ouvre le fichier à la ligne.",
      ),
    },
    {
      id: "history",
      icon: History,
      label: t("Historique du projet"),
      about: t("Les sessions de Claude Code lancées dans ce projet ou dessous."),
    },
    {
      id: "skills",
      icon: Sparkles,
      label: t("Skills du projet"),
      doc: "projet#skills",
      about: t(
        "Un skill est un .claude/skills/<nom>/SKILL.md. Claude le charge seul quand la description correspond, ou par /nom.",
      ),
    },
    {
      id: "mcp",
      icon: Plug,
      label: t("MCP du projet"),
      doc: "projet#l-etat-des-serveurs-mcp",
      about: t("Serveurs déclarés dans .mcp.json, à la racine du dépôt, partagés par l'équipe."),
    },
    {
      id: "worktrees",
      icon: FolderGit2,
      label: "Worktrees",
      doc: "git#worktrees",
      about: t("Les worktrees git du dépôt, leur état et les sessions qui y vivent."),
    },
  ];
  return [...core.slice(0, 3), ...fromModules, ...core.slice(3)];
}

/** En-tête d'une vue : son titre, ce qu'elle montre sur demande, et ses actions. */
function ViewHeader({ title, about, doc, actions }: { title: string; about?: string; doc?: string; actions?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="shrink-0 border-b">
      <div className="flex items-center gap-1 px-3 py-1.5">
        <span className="flex-1 truncate text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{title}</span>
        {actions}
        {about && (
          <Button
            variant="ghost"
            size="icon"
            className={cn("size-6", open && "bg-accent text-primary")}
            title={t("À quoi sert cette vue")}
            onClick={() => setOpen((value) => !value)}
          >
            <Info />
          </Button>
        )}
      </div>
      {open && about && (
        <p className="px-3 pb-2 text-[11px] leading-relaxed text-muted-foreground">
          {about}
          {doc && (
            <>
              {" "}
              <a href={docUrl(doc)} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">
                {t("Guide")}
              </a>
            </>
          )}
        </p>
      )}
    </div>
  );
}

/** Hauteur du bas d'une pile, tirée à la souris et mémorisée. */
function useStackHeight(id: string, fallback: number): [number, (value: number) => void] {
  const height = useStore((state) => state.stacks[id]) ?? fallback;
  return [height, (value) => setState((current) => ({ stacks: { ...current.stacks, [id]: value } }))];
}

/** L'explorateur au-dessus, les dossiers liés dessous, séparés par une poignée. */
function ExplorerStack({ project }: { project: Project }) {
  const [height, setHeight] = useStackHeight("explorer/links", 200);
  const start = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  return (
    // Deux îlots, comme le terminal et le bloc du bas : l'explorateur, puis les dossiers liés.
    <div ref={box} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <Island className="min-h-0 flex-1">
        <FileTree project={project} />
      </Island>
      <Splitter
        orientation="horizontal"
        className="on-canvas"
        onStart={() => (start.current = height)}
        onDrag={(dy) => setHeight(clamp(start.current - dy, 60, (box.current?.clientHeight ?? 600) - 120))}
        onReset={() => setHeight(200)}
      />
      <div className="flex min-h-0 shrink-0 [&>*]:flex-1" style={{ height }} data-linked-island>
        <Island>
          <ViewHeader title={t("Dossiers liés")} />
          <ScrollArea className="min-h-0 flex-1">
            <div className="px-3 py-2">
              <LinksPanel root={project.root} />
            </div>
          </ScrollArea>
        </Island>
      </div>
    </div>
  );
}

export function ProjectColumn() {
  const project = useStore(activeProject);
  const disabledModules = useStore((state) => state.disabledModules);
  const [filter, setFilter] = useState("");

  // L'application ne la montre qu'avec un projet ouvert.
  if (!project) return null;

  const activities = projectActivities(disabledModules);
  const activity = activities.find((entry) => entry.id === project.leftMode) ?? (activities[0] as (typeof activities)[number]);

  if (activity.id === "explorer") return <ExplorerStack project={project} />;

  const body = () => {
    if (activity.render) return activity.render(project.root);
    switch (activity.id) {
      case "search":
        return <FileSearchPanel root={project.root} />;
      case "history":
        return <HistoryPanel filter={filter} fixedScope="project" />;
      case "skills":
        return <ProjectSkillsPanel root={project.root} />;
      case "mcp":
        return <ProjectMcpPanel root={project.root} />;
      default:
        return <WorktreesPanel root={project.root} />;
    }
  };

  return (
    <Island>
      <ViewHeader title={activity.label} about={activity.about} {...(activity.doc ? { doc: activity.doc } : {})} />
      {activity.id === "history" && (
        <div className="shrink-0 px-3 pt-2">
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t("Filtrer…")}
            spellCheck={false}
            className="h-7 text-[12px]"
          />
        </div>
      )}
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-3 py-2">{body()}</div>
      </ScrollArea>
    </Island>
  );
}

// ─── Colonne globale ────────────────────────────────────────────────────────


export function GlobalColumn() {
  const globalTab = useStore((state) => state.globalTab);
  const disabledModules = useStore((state) => state.disabledModules);
  const moduleView = moduleGlobalViews(disabledModules).find((view) => view.id === globalTab);
  const [filter, setFilter] = useState("");
  const [nonce, setNonce] = useState(0);
  const searchable =
    globalTab === "history" ||
    globalTab === "skills" ||
    globalTab === "chantiers" ||
    globalTab === "search" ||
    moduleView?.searchable === true;

  const panel = () => {
    if (moduleView) return <div key={nonce}>{moduleView.render({ filter })}</div>;
    switch (globalTab) {
      case "processes":
        return <ProcessesPanel key={nonce} />;
      case "history":
        return <HistoryPanel key={nonce} filter={filter} />;
      case "skills":
        return <UserSkillsPanel key={nonce} filter={filter} />;
      case "mcp":
        return <UserMcpPanel key={nonce} />;
      case "chantiers":
        return <ChantiersPanel key={nonce} filter={filter} />;
      case "search":
        return <SearchPanel key={nonce} query={filter} />;
      default:
        return <NotificationsPanel key={nonce} />;
    }
  };

  const layout = useStore((state) => state.tabLayout);

  const body = (
    <>

      <div className="flex shrink-0 items-center gap-1.5 px-3 py-2">
        {searchable && (
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={globalTab === "skills" ? t("Rechercher un skill ou une commande…") : t("Filtrer…")}
            spellCheck={false}
            className="h-7 flex-1 text-[12px]"
          />
        )}
        <Button
          variant="ghost"
          size="icon"
          className={cn("size-7", searchable ? "" : "ml-auto")}
          onClick={() => setNonce((value) => value + 1)}
          title={t("Recharger")}
        >
          <RefreshCw />
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-3 pb-3">{panel()}</div>
      </ScrollArea>
    </>
  );

  // En colonne, la barre d'onglets vit au bord de la fenêtre, hors de l'îlot :
  // elle reste visible quand la colonne est repliée.
  if (layout === "column") return <Island>{body}</Island>;
  return (
    <Island>
      <TabRow current={globalTab} />
      {body}
    </Island>
  );
}
