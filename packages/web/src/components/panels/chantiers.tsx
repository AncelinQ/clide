import { ChevronDown, ChevronRight, ExternalLink, Layers } from "lucide-react";
import { useState } from "react";

import { ActionButton, Async, Empty, useAsync } from "@/components/common";
import { formatUsd } from "@/components/panels/costs";
import { Badge } from "@/components/ui/badge";
import { t } from "@/i18n";
import { api, formatDate, shortName } from "@/lib/api";
import type { SessionSummary } from "@/lib/types";
import { openProject, setState } from "@/state/store";
import { openTerminal } from "@/state/terminals";
import { cn } from "cn";

interface Chantier {
  key: string;
  kind: "ticket" | "branche";
  title?: string;
  url?: string;
  status?: string;
  statusAt?: string;
  statusSetByClaude?: boolean;
  branches: string[];
  worktrees: string[];
  mrs: { prUrl?: string; prNumber?: number; prRepository?: string }[];
  sessions: {
    sessionId: string;
    relation: "travaillée" | "consultée";
    title?: string;
    gitBranch?: string;
    cwd?: string;
    lastActivityAt?: string;
  }[];
  lastActivityAt?: string;
  cost: { usd: number; partial: boolean };
}

/** Un chantier est « travaillé » quand une branche ou une MR s'y rattache. */
const isWorked = (chantier: Chantier) => chantier.branches.length > 0 || chantier.mrs.length > 0;

function ChantierRow({ chantier }: { chantier: Chantier }) {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <li className="border-b py-1.5 last:border-0">
      <button type="button" className="flex w-full items-start gap-1.5 text-left" onClick={() => setOpen(!open)}>
        <Chevron className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-1.5">
            <span className="font-mono text-[11.5px] font-medium">{chantier.key}</span>
            {chantier.status && (
              <Badge
                variant="outline"
                title={t(chantier.statusSetByClaude ? "État fixé par Claude le {date}" : "État lu par Claude le {date}", {
                  date: formatDate(chantier.statusAt),
                })}
              >
                {chantier.status}
              </Badge>
            )}
            {chantier.mrs.length > 0 && <Badge variant="secondary">MR</Badge>}
          </span>
          {chantier.title && <span className="block truncate text-[12px]">{chantier.title}</span>}
          <span className="block text-[11px] text-muted-foreground">
            {[
              formatDate(chantier.lastActivityAt),
              t("{count} session(s)", { count: chantier.sessions.length }),
              chantier.cost.usd > 0 ? `${chantier.cost.partial ? "≥ " : ""}${formatUsd(chantier.cost.usd)}` : "",
            ]
              .filter(Boolean)
              .join("  ·  ")}
          </span>
        </span>
      </button>

      {open && (
        <div className="mt-1.5 ml-5 grid gap-1.5 text-[11.5px]">
          {chantier.url && (
            <a href={chantier.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-primary">
              <ExternalLink className="size-3" /> {t("Ouvrir dans Linear")}
            </a>
          )}
          {chantier.branches.length > 0 && (
            <Group label={t("Branches")}>
              {chantier.branches.map((branch) => (
                <span key={branch} className="block truncate font-mono text-[11px]">
                  {branch}
                </span>
              ))}
            </Group>
          )}
          {chantier.worktrees.length > 0 && (
            <Group label={t("Worktrees")}>
              {chantier.worktrees.map((path) => (
                <span key={path} className="block truncate font-mono text-[11px]" title={path}>
                  {shortName(path)}
                </span>
              ))}
            </Group>
          )}
          {chantier.mrs.length > 0 && (
            <Group label={t("Merge requests")}>
              {chantier.mrs.map((mr) => (
                <a
                  key={mr.prUrl}
                  href={mr.prUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 truncate text-primary"
                >
                  <ExternalLink className="size-3 shrink-0" />
                  {mr.prNumber ? `!${mr.prNumber}` : mr.prUrl}
                  {mr.prRepository && <span className="truncate text-muted-foreground">{shortName(mr.prRepository)}</span>}
                </a>
              ))}
            </Group>
          )}
          <Group label={t("Sessions")}>
            {chantier.sessions.map((session) => (
              <div key={session.sessionId} className="flex items-center gap-1.5">
                <button
                  type="button"
                  className={cn(
                    "min-w-0 flex-1 truncate text-left hover:underline",
                    session.relation === "consultée" && "text-muted-foreground",
                  )}
                  title={t(session.relation === "travaillée" ? "travaillée sur la branche du chantier" : "ticket consulté depuis une autre branche")}
                  onClick={() =>
                    setState({
                      selectedSession: { sessionId: session.sessionId, ...(session.title ? { title: session.title } : {}) } as SessionSummary,
                      followLive: false,
                    })
                  }
                >
                  {session.title ?? session.sessionId.slice(0, 8)}
                  <span className="ml-1.5 text-[10.5px] text-muted-foreground">{formatDate(session.lastActivityAt)}</span>
                </button>
                <ActionButton
                  variant="ghost"
                  onAction={() => {
                    if (session.cwd) openProject(session.cwd);
                    openTerminal("claude", { cwd: session.cwd, command: `claude --resume ${session.sessionId}` });
                  }}
                >
                  {t("reprendre")}
                </ActionButton>
              </div>
            ))}
          </Group>
        </div>
      )}
    </li>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10.5px] tracking-wide text-muted-foreground uppercase">{label}</div>
      {children}
    </div>
  );
}

/**
 * Chantiers : une journée de travail va d'un ticket à une branche, un worktree,
 * des sessions et une MR. Tout vient des transcripts ; l'état d'un ticket est le
 * dernier que Claude a lu ou fixé, daté, pas celui du moment.
 */
export function ChantiersPanel({ filter }: { filter: string }) {
  const state = useAsync(() => api<{ chantiers: Chantier[] }>("/api/chantiers"), []);
  const [all, setAll] = useState(false);
  return (
    <Async state={state}>
      {({ chantiers }) => {
        const needle = filter.trim().toLowerCase();
        const shown = chantiers
          .filter((chantier) => all || isWorked(chantier))
          .filter((chantier) =>
            needle
              ? `${chantier.key} ${chantier.title ?? ""} ${chantier.branches.join(" ")} ${chantier.status ?? ""}`
                  .toLowerCase()
                  .includes(needle)
              : true,
          );
        const hidden = chantiers.filter((chantier) => !isWorked(chantier)).length;
        return (
          <>
            <label className="flex items-center gap-2 py-1 text-[11px] text-muted-foreground">
              <input type="checkbox" className="accent-primary" checked={all} onChange={(event) => setAll(event.target.checked)} />
              {t("montrer aussi les tickets seulement consultés ({count})", { count: hidden })}
            </label>
            {shown.length === 0 ? (
              <Empty icon={Layers}>{t("Aucun chantier.")}</Empty>
            ) : (
              <ul className="m-0 list-none p-0">
                {shown.slice(0, 150).map((chantier) => (
                  <ChantierRow key={`${chantier.kind}|${chantier.key}`} chantier={chantier} />
                ))}
              </ul>
            )}
          </>
        );
      }}
    </Async>
  );
}
