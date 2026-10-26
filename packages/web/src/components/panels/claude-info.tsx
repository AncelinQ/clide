import { Download, ExternalLink, RefreshCw } from "lucide-react";

import { ActionButton, Async, FoldSection, useAsync } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { STATUS_PAGE, statusErrorText, statusLabel, statusTone, type StatusTone } from "@/lib/claude-info";
import type { ClaudeInfo } from "@/lib/types";
import { useStore } from "@/state/store";
import { openTerminal } from "@/state/terminals";
import { cn } from "cn";

const DOT: Record<StatusTone, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  error: "bg-destructive",
};

function RefreshButton({ onRefresh }: { onRefresh: () => Promise<void> }) {
  return (
    <ActionButton onAction={onRefresh}>
      <RefreshCw className="size-3" /> {t("Actualiser")}
    </ActionButton>
  );
}

/** Version installée, comparée à la dernière publiée, et la mise à jour quand elle existe. */
function ClaudeCodeBody({ info, onRefresh }: { info: ClaudeInfo; onRefresh: () => Promise<void> }) {
  const activeRoot = useStore((state) => state.activeRoot);

  return (
    <div className="flex flex-col gap-2 py-2">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span className="tabular-nums">
          {info.version ? t("Version {version}", { version: info.version }) : t("Version introuvable")}
        </span>
        {info.version &&
          info.latest &&
          (info.update ? (
            <Badge>{t("{version} disponible", { version: info.update })}</Badge>
          ) : (
            <Badge variant="outline">{t("à jour")}</Badge>
          ))}
        <span className="flex-1" />
        <RefreshButton onRefresh={onRefresh} />
      </div>
      {!info.version && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {t("claude --version n'a pas répondu : la CLI n'est pas dans le PATH de Clide.")}
        </p>
      )}
      {info.update && (
        <div className="flex flex-col items-start gap-1">
          <Button
            size="sm"
            className="h-6 px-2 text-[11px]"
            disabled={!activeRoot}
            onClick={() => openTerminal("shell", { command: "claude update", label: "claude update" })}
          >
            <Download className="size-3" /> {t("Mettre à jour Claude Code")}
          </Button>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {activeRoot
              ? t("Lance claude update dans un nouvel onglet shell du projet ouvert.")
              : t("Ouvre un projet : la mise à jour se lance dans un de ses onglets.")}
          </p>
        </div>
      )}
    </div>
  );
}

/** État de status.claude.com : l'ensemble, les composants dégradés, les incidents en cours. */
function ServicesBody({ info, onRefresh }: { info: ClaudeInfo; onRefresh: () => Promise<void> }) {
  const status = info.status;
  const failure = statusErrorText(info.statusError ?? "");

  return (
    <div className="flex flex-col gap-2 py-2 text-[12px]">
      <div className="flex items-center gap-2">
        {status ? (
          <>
            {/* La couleur double le texte, qui seul dit l'état. */}
            <span aria-hidden className={cn("size-2 shrink-0 rounded-full", DOT[statusTone(status.indicator)])} />
            <span className="min-w-0 flex-1">
              {status.indicator === "none" ? t("Tous les services fonctionnent") : status.description}
            </span>
          </>
        ) : (
          <span className="min-w-0 flex-1 text-destructive">
            {t("Page de statut indisponible : {reason}", { reason: t(failure.text, failure.values) })}
          </span>
        )}
        <RefreshButton onRefresh={onRefresh} />
      </div>

      {status && status.degraded.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {status.degraded.map((component) => (
            <li key={component.name} className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate">{component.name}</span>
              <span className="shrink-0 text-[11px] text-amber-600 dark:text-amber-400">{t(statusLabel(component.status))}</span>
            </li>
          ))}
        </ul>
      )}

      {status && status.incidents.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label={t("Incidents en cours")}>
          {status.incidents.map((incident) => (
            <li key={incident.name} className="flex flex-col">
              {incident.url ? (
                <a href={incident.url} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">
                  {incident.name}
                </a>
              ) : (
                <span>{incident.name}</span>
              )}
              <span className="text-[11px] text-muted-foreground">{t(statusLabel(incident.status))}</span>
            </li>
          ))}
        </ul>
      )}

      <a
        href={STATUS_PAGE}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 self-start text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        status.claude.com <ExternalLink aria-hidden className="size-3" />
      </a>
    </div>
  );
}

/**
 * Les sections « Claude Code » et « Services Anthropic » de l'onglet
 * Consommation, lues ensemble : une seule route, que le serveur garde un moment.
 */
export function ClaudeInfoSections() {
  const state = useAsync(() => api<ClaudeInfo>("/api/claude-info"), []);
  const refresh = async () => {
    await api<ClaudeInfo>("/api/claude-info", { refresh: "1" });
    state.reload();
  };

  return (
    <>
      <FoldSection id="consumption.claude" title="Claude Code">
        <Async state={state}>{(info) => <ClaudeCodeBody info={info} onRefresh={refresh} />}</Async>
      </FoldSection>
      <FoldSection id="consumption.services" title={t("Services Anthropic")}>
        <Async state={state}>{(info) => <ServicesBody info={info} onRefresh={refresh} />}</Async>
      </FoldSection>
    </>
  );
}
