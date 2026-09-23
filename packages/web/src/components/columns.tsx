import { Bell, Coins, Cpu, GitBranch, History, Layers, Link2, Package, Plug, RefreshCw, Search, Settings, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { FileBrowser } from "@/components/FileBrowser";
import { ModeBlock, type Mode } from "@/components/ModeBlock";
import { TabRail, TabRow } from "@/components/GlobalTabs";
import { ChantiersPanel } from "@/components/panels/chantiers";
import { CostsPanel } from "@/components/panels/costs";
import { SearchPanel } from "@/components/panels/search";
import {
  LinksPanel,
  ProjectMcpPanel,
  ProjectSkillsPanel,
  ScriptsPanel,
  WorktreesPanel,
} from "@/components/panels/project";
import {
  HistoryPanel,
  NotificationsPanel,
  ProcessesPanel,
  SettingsPanel,
  UserMcpPanel,
  UserSkillsPanel,
} from "@/components/panels/global";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "cn";
import { t } from "@/i18n";
import { activeProject, setState, updateProject, useStore } from "@/state/store";

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

export function ProjectColumn() {
  const project = useStore(activeProject);

  if (!project) {
    return (
      <Island>
        <p className="p-4 text-muted-foreground">{t("Aucun projet ouvert.")}</p>
      </Island>
    );
  }

  const modes: Mode[] = [
    {
      id: "links",
      icon: Link2,
      title: t("Dossiers liés"),
      about: t(
        "Les autres projets dont celui-ci dépend. Leurs chemins vont dans .claude/settings.local.json, qui en donne l'accès à Claude ; leurs rôles vont dans un fichier de prompt que chaque session reçoit, qui lui dit à quoi ils servent.",
      ),
      render: () => <LinksPanel root={project.root} />,
    },
    {
      id: "scripts",
      icon: Package,
      title: "Scripts",
      about: t("Scripts du package.json, espaces de travail compris. Le gestionnaire vient du lockfile."),
      render: () => <ScriptsPanel root={project.root} />,
    },
    {
      id: "skills",
      icon: Sparkles,
      title: t("Skills du projet"),
      about: t(
        "Un skill est un .claude/skills/<nom>/SKILL.md. Claude le charge seul quand la description correspond, ou par /nom.",
      ),
      render: () => <ProjectSkillsPanel root={project.root} />,
    },
    {
      id: "mcp",
      icon: Plug,
      title: t("MCP du projet"),
      about: t("Serveurs déclarés dans .mcp.json, à la racine du dépôt, partagés par l'équipe."),
      render: () => <ProjectMcpPanel root={project.root} />,
    },
    {
      id: "worktrees",
      icon: GitBranch,
      title: "Worktrees",
      about: t("Les worktrees git du dépôt, leur état et les sessions qui y vivent."),
      render: () => <WorktreesPanel root={project.root} />,
    },
  ];

  return (
    <Island>
      <FileBrowser project={project} />
      <ModeBlock
        modes={modes}
        current={project.leftMode}
        onPick={(id) => updateProject(project.root, { leftMode: id })}
        className="max-h-[46%]"
      />
    </Island>
  );
}

// ─── Colonne globale ────────────────────────────────────────────────────────


export function GlobalColumn() {
  const globalTab = useStore((state) => state.globalTab);
  const [filter, setFilter] = useState("");
  const [nonce, setNonce] = useState(0);
  const searchable =
    globalTab === "history" || globalTab === "skills" || globalTab === "chantiers" || globalTab === "search";

  const panel = () => {
    switch (globalTab) {
      case "processes":
        return <ProcessesPanel key={nonce} />;
      case "history":
        return <HistoryPanel key={nonce} filter={filter} />;
      case "skills":
        return <UserSkillsPanel key={nonce} filter={filter} />;
      case "mcp":
        return <UserMcpPanel key={nonce} />;
      case "settings":
        return <SettingsPanel key={nonce} />;
      case "costs":
        return <CostsPanel key={nonce} />;
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
            placeholder={t("Filtrer…")}
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

  if (layout === "column") {
    return (
      <Island className="flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{body}</div>
        <TabRail current={globalTab} />
      </Island>
    );
  }
  return (
    <Island>
      <TabRow current={globalTab} />
      {body}
    </Island>
  );
}
