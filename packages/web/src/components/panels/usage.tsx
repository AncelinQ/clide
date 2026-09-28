import { Gauge, RefreshCw } from "lucide-react";

import { ActionButton, Async, Empty, FoldSection, Row, Rows, useAsync } from "@/components/common";
import { formatUsd } from "@/components/panels/costs";
import { Badge } from "@/components/ui/badge";
import { decimal, t } from "@/i18n";
import { api, formatDate, post, shortName } from "@/lib/api";
import type { UsageLimit, UsageReading, UsageReport } from "@/lib/types";
import { cn } from "cn";

/** Nom d'une limite, tel que `/usage` l'écrit. */
function limitLabel(limit: UsageLimit): string {
  switch (limit.kind) {
    case "session":
      return t("Session (5 h)");
    case "weekly_all":
      return t("Semaine, tous modèles");
    case "weekly_scoped":
      return t("Semaine, {model}", { model: limit.model ?? t("restreinte") });
    case "spend":
      return t("Crédit supplémentaire");
    default:
      return limit.kind;
  }
}

/** « dans 2 h 14 », « dans 3 j » : le temps qui reste avant une réinitialisation. */
function untilLabel(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((Date.parse(iso) - now) / 60_000));
  if (minutes < 60) return t("dans {minutes} min", { minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return t("dans {hours} h {minutes}", { hours, minutes: String(minutes % 60).padStart(2, "0") });
  return t("dans {days} j", { days: Math.round(hours / 24) });
}

/** « il y a 3 min » : l'âge d'un relevé. */
export function agoLabel(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return t("à l'instant");
  if (minutes < 60) return t("il y a {minutes} min", { minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return t("il y a {hours} h", { hours });
  return t("il y a {days} j", { days: Math.round(hours / 24) });
}

/**
 * Sévérité d'un remplissage. La couleur n'est jamais seule : au-delà de la
 * normale, un libellé dit l'état.
 */
function severityOf(percent: number, reported?: string): "normal" | "high" | "critical" {
  if (percent >= 90 || (reported && reported !== "normal" && percent >= 70)) return "critical";
  if (percent >= 70) return "high";
  return "normal";
}

const TONE = {
  normal: { fill: "bg-primary", track: "bg-primary/15", label: undefined },
  high: { fill: "bg-amber-500", track: "bg-amber-500/20", label: "élevé" },
  critical: { fill: "bg-destructive", track: "bg-destructive/15", label: "presque atteinte" },
} as const;

/** Jauge d'un pourcentage : remplissage fin, fond de la même teinte, valeur écrite à côté. */
function Meter({ percent, severity, title }: { percent: number; severity?: string; title?: string }) {
  const tone = TONE[severityOf(percent, severity)];
  const width = Math.min(100, Math.max(0, percent));
  return (
    <div className="flex items-center gap-2" title={title}>
      <div className={cn("h-1.5 min-w-0 flex-1 overflow-hidden rounded-full", tone.track)}>
        <div className={cn("h-full rounded-full", tone.fill)} style={{ width: `${width}%` }} />
      </div>
      <span className="w-10 shrink-0 text-right text-[11.5px] tabular-nums">{Math.round(percent)} %</span>
    </div>
  );
}

function LimitRow({ limit }: { limit: UsageLimit }) {
  const tone = TONE[severityOf(limit.percent, limit.severity)];
  return (
    <li className="py-1.5">
      <div className="flex items-baseline gap-2 text-[12px]">
        <span className="min-w-0 flex-1 truncate">{limitLabel(limit)}</span>
        {tone.label && (
          <span className="shrink-0 text-[11px] font-medium text-muted-foreground">{t(tone.label)}</span>
        )}
      </div>
      <Meter
        percent={limit.percent}
        {...(limit.severity ? { severity: limit.severity } : {})}
        title={limit.resetsAt ? t("Réinitialisation le {date}", { date: formatDate(limit.resetsAt) }) : undefined}
      />
      {limit.resetsAt && (
        <div className="text-[11px] text-muted-foreground">
          {t("réinitialisée {when}", { when: untilLabel(limit.resetsAt) })}
        </div>
      )}
    </li>
  );
}

/** Relevé le plus récent des deux sources, et d'où il vient. */
function latest(report: UsageReport): { reading: UsageReading; source: "live" | "api" } | undefined {
  const live = report.live && report.live.limits.length > 0 ? report.live : undefined;
  const fromApi = report.api && report.api.limits.length > 0 ? report.api : undefined;
  if (live && (!fromApi || Date.parse(live.at) >= Date.parse(fromApi.at))) return { reading: live, source: "live" };
  if (fromApi) return { reading: fromApi, source: "api" };
  return undefined;
}

/**
 * Usage de l'abonnement, comme `/usage` le montre : limites de la session de
 * 5 h et de la semaine, et ce que chaque session récente a consommé.
 *
 * Deux sources. La ligne de statut, documentée, reçoit les limites de Claude
 * Code à chaque réponse : elle ne sait rien hors d'une session. L'API interne
 * que `/usage` interroge répond à tout moment, mais seulement quand on le
 * demande : elle n'est pas documentée et limite les appels.
 */
export function UsagePanel() {
  const state = useAsync(() => api<UsageReport>("/api/usage"), []);

  return (
    <Async state={state}>
      {(report) => {
        const current = latest(report);
        return (
          <div className="flex flex-col gap-1 pb-3">
            <div className="flex items-center gap-2 pt-2">
              <span className="min-w-0 flex-1 text-[11px] text-muted-foreground">
                {current
                  ? t(current.source === "live" ? "Relevé par la ligne de statut, {ago}" : "Relevé par l'API, {ago}", {
                      ago: agoLabel(current.reading.at),
                    })
                  : t("Aucun relevé pour l'instant.")}
                {report.api?.subscription && (
                  <>
                    {" · "}
                    {t("abonnement {plan}", { plan: report.api.subscription })}
                  </>
                )}
              </span>
              <ActionButton
                onAction={async () => {
                  await post("/api/usage/refresh", {});
                  state.reload();
                }}
              >
                <RefreshCw className="size-3" /> {t("Actualiser")}
              </ActionButton>
            </div>

            {current ? (
              <ul className="m-0 list-none p-0">
                {current.reading.limits.map((limit) => (
                  <LimitRow key={`${limit.kind}|${limit.model ?? ""}`} limit={limit} />
                ))}
              </ul>
            ) : (
              <Empty icon={Gauge}>
                {t("« Actualiser » interroge l'API ; la ligne de statut relève l'usage pendant les sessions.")}
              </Empty>
            )}
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {t(
                "« Actualiser » passe par l'API interne de Claude Code, celle de /usage : non documentée, elle peut changer ou limiter les appels.",
              )}
            </p>

            <FoldSection id="usage.statusline" title={t("Ligne de statut")}>
              <div className="flex flex-col gap-2 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={report.statusline.installed ? "default" : "outline"}>
                    {report.statusline.installed ? t("installée") : t("absente")}
                  </Badge>
                  {!report.statusline.foreign && (
                    <ActionButton
                      variant={report.statusline.installed ? "outline" : "default"}
                      onAction={async () => {
                        await post(
                          report.statusline.installed
                            ? "/api/usage/statusline/uninstall"
                            : "/api/usage/statusline/install",
                          {},
                        );
                        state.reload();
                      }}
                    >
                      {report.statusline.installed ? t("Désinstaller") : t("Installer la ligne de statut")}
                    </ActionButton>
                  )}
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {report.statusline.foreign
                    ? t("Une autre ligne de statut est configurée ({command}) : Clide ne la remplace pas.", {
                        command: report.statusline.foreign,
                      })
                    : t(
                        "Claude Code lui transmet les limites et l'état de la session à chaque réponse : elle les relève pour cet onglet et affiche un résumé sous le prompt. Déclarée dans ~/.claude/settings.json, sauvegardé avant la première modification.",
                      )}
                </p>
              </div>
            </FoldSection>

            {report.sessions.length > 0 && (
              <FoldSection id="usage.sessions" title={t("Sessions récentes")} count={report.sessions.length}>
                <Rows>
                  {report.sessions.map((session) => (
                    <Row
                      key={session.sessionId}
                      title={session.cwd ? shortName(session.cwd) : session.sessionId.slice(0, 8)}
                      badges={session.model && <Badge variant="secondary">{session.model}</Badge>}
                      sub={[
                        agoLabel(session.at),
                        session.costUsd !== undefined ? formatUsd(session.costUsd) : "",
                        session.linesAdded !== undefined || session.linesRemoved !== undefined
                          ? `+${session.linesAdded ?? 0} −${session.linesRemoved ?? 0}`
                          : "",
                        session.durationMs !== undefined
                          ? t("{minutes} min", { minutes: decimal(session.durationMs / 60_000, 0) })
                          : "",
                      ]
                        .filter(Boolean)
                        .join("  ·  ")}
                    >
                      {session.contextPercent !== undefined && (
                        <div>
                          <div className="text-[11px] text-muted-foreground">{t("Contexte")}</div>
                          <Meter
                            percent={session.contextPercent}
                            {...(session.contextSize
                              ? { title: t("fenêtre de {tokens} tokens", { tokens: session.contextSize }) }
                              : {})}
                          />
                        </div>
                      )}
                    </Row>
                  ))}
                </Rows>
              </FoldSection>
            )}
          </div>
        );
      }}
    </Async>
  );
}
