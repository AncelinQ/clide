import {
  Bell,
  Cpu,
  GitBranch,
  History,
  Link2,
  Package,
  Plug,
  RefreshCw,
  Settings,
  Sparkles,
} from "lucide-react";
import { useState } from "react";

import { FileBrowser } from "@/components/FileBrowser";
import { ModeBlock, type Mode } from "@/components/ModeBlock";
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

const TABS = [
  { id: "processes", icon: Cpu, label: "Process" },
  { id: "history", icon: History, label: "History" },
  { id: "skills", icon: Sparkles, label: "Skills" },
  { id: "mcp", icon: Plug, label: "MCP" },
  { id: "settings", icon: Settings, label: "Réglages" },
  { id: "notifications", icon: Bell, label: "Alertes" },
] as const;

export function GlobalColumn() {
  const globalTab = useStore((state) => state.globalTab);
  const [filter, setFilter] = useState("");
  const [nonce, setNonce] = useState(0);
  const searchable = globalTab === "history" || globalTab === "skills";

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
      default:
        return <NotificationsPanel key={nonce} />;
    }
  };

  return (
    <Island>
      {/* Icône au-dessus du libellé, comme dans l'original. */}
      <nav className="flex shrink-0 justify-around gap-0.5 border-b px-1.5 py-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setState({ globalTab: tab.id })}
            className={cn(
              "flex min-w-12 flex-col items-center gap-1 rounded-lg border px-1.5 py-1.5 text-[10px] transition-colors",
              tab.id === globalTab
                ? "border-primary bg-primary text-primary-foreground"
                : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <tab.icon className="size-4" />
            {t(tab.label)}
          </button>
        ))}
      </nav>

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
    </Island>
  );
}
