import { Coins } from "lucide-react";

import { Async, Empty, FoldSection, useAsync } from "@/components/common";
import { decimal, t } from "@/i18n";
import { api, shortName } from "@/lib/api";
import type { SessionCost } from "@/lib/types";

interface CostReport {
  total: { exact: number; estimated: number; atLeast: number };
  sessions: { exact: number; estimated: number; atLeast: number; unknown: number };
  byDay: { day: string; usd: number }[];
  byProject: { project: string; usd: number; sessions: number }[];
  byModel: { model: string; usd: number }[];
  unpriced: string[];
  calibration: { model: string; inputPerMillion: number; samples: number; method: string }[];
}

/** « 12,34 $ » : le montant seul, deux décimales. */
export function formatUsd(usd: number): string {
  return t("{cost} $", { cost: decimal(usd, 2) });
}

/**
 * Coût d'une session, avec ce qu'il vaut : exact, estimé (≈) ou plancher (≥).
 * Un montant estimé ne se présente jamais comme un relevé ; un coût inconnu ne
 * s'affiche pas.
 */
export function formatSessionCost(price: SessionCost | undefined): string | undefined {
  if (!price) return undefined;
  switch (price.kind) {
    case "exact":
      return formatUsd(price.usd);
    case "estimated":
      return `≈ ${formatUsd(price.usd)}`;
    case "atLeast":
      return `≥ ${formatUsd(price.usd)}`;
    case "unknown":
      return undefined;
  }
}

/** Ce que vaut un coût, pour l'infobulle. */
export function describeSessionCost(price: SessionCost | undefined): string | undefined {
  if (!price) return undefined;
  switch (price.kind) {
    case "exact":
      return t("Relevé par Claude Code.");
    case "estimated":
      return t("Estimé à partir des tarifs déduits de tes sessions chiffrées.");
    case "atLeast":
      return t("Au moins : {models} sans tarif fiable.", { models: price.unpriced.join(", ") });
    case "unknown":
      return t("Aucun tarif fiable pour {models}.", { models: price.unpriced.join(", ") });
  }
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border px-3 py-2" title={hint}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-[18px] font-semibold tabular-nums">{value}</div>
    </div>
  );
}

/**
 * Barres horizontales d'une seule série : une teinte, pas de légende, le montant
 * écrit à côté de chaque barre. Le plus grand fixe l'échelle.
 */
function Bars({ rows }: { rows: { label: string; usd: number; title?: string }[] }) {
  const max = Math.max(...rows.map((row) => row.usd), 0);
  return (
    <ul className="m-0 grid list-none gap-0.5 p-0">
      {rows.map((row) => (
        <li
          key={row.label}
          title={`${row.title ?? row.label} — ${formatUsd(row.usd)}`}
          className="grid grid-cols-[7.5rem_1fr_4.5rem] items-center gap-2 rounded px-1 py-[3px] text-[11.5px] hover:bg-accent/60"
        >
          <span className="truncate text-muted-foreground">{row.label}</span>
          <span className="block h-2.5">
            <span
              className="block h-full rounded-r-[4px] bg-primary"
              style={{ width: max > 0 ? `${Math.max((row.usd / max) * 100, 1)}%` : "0%" }}
            />
          </span>
          <span className="text-right tabular-nums">{formatUsd(row.usd)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Consommation : ce que les sessions ont coûté, par jour, par projet et par
 * modèle. Voir suffit, décider reste humain : ni budget, ni alerte.
 */
export function CostsPanel() {
  const state = useAsync(() => api<CostReport>("/api/costs"), []);
  return (
    <Async state={state}>
      {(report) => {
        const total = report.total.exact + report.total.estimated + report.total.atLeast;
        if (total === 0) return <Empty icon={Coins}>{t("Aucune session chiffrable.")}</Empty>;
        const estimatedShare = total > 0 ? (report.total.estimated + report.total.atLeast) / total : 0;
        return (
          <div className="flex flex-col gap-1 pb-3">
            <div className="grid grid-cols-2 gap-2 py-2">
              <Tile label={t("Total")} value={formatUsd(total)} />
              <Tile
                label={t("dont estimé")}
                value={`${Math.round(estimatedShare * 100)} %`}
                hint={t("Part chiffrée à partir des tarifs déduits, pas relevée par Claude Code.")}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              {t("{exact} sessions relevées, {estimated} estimées, {unknown} sans tarif.", {
                exact: report.sessions.exact,
                estimated: report.sessions.estimated + report.sessions.atLeast,
                unknown: report.sessions.unknown,
              })}
            </p>

            <FoldSection id="costs.days" title={t("Par jour")}>
              <Bars rows={report.byDay.slice(-21).map((row) => ({ label: row.day.slice(5).replace("-", "/"), usd: row.usd, title: row.day }))} />
            </FoldSection>

            <FoldSection id="costs.projects" title={t("Par projet")}>
              <Bars
                rows={report.byProject.slice(0, 12).map((row) => ({
                  label: shortName(row.project),
                  usd: row.usd,
                  title: t("{project} · {count} sessions", { project: row.project, count: row.sessions }),
                }))}
              />
            </FoldSection>

            <FoldSection id="costs.models" title={t("Par modèle")}>
              <Bars rows={report.byModel.map((row) => ({ label: row.model.replace(/^claude-/, ""), usd: row.usd, title: row.model }))} />
            </FoldSection>

            <FoldSection id="costs.prices" title={t("Tarifs")}>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {t(
                  "Déduits des coûts que Claude Code a lui-même relevés, jamais écrits en dur. Un modèle n'en reçoit que si ses relevés concordent à 2 % près, sur au moins trois sessions.",
                )}
              </p>
              <ul className="m-0 grid list-none gap-0.5 p-0 text-[11.5px]">
                {report.calibration.map((entry) => (
                  <li key={entry.model} className="flex gap-2">
                    <span className="min-w-0 flex-1 truncate">{entry.model}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {t("{price} $/M en entrée · {count} relevés", {
                        price: decimal(entry.inputPerMillion, 2),
                        count: entry.samples,
                      })}
                    </span>
                  </li>
                ))}
                {report.unpriced.map((model) => (
                  <li key={model} className="flex gap-2">
                    <span className="min-w-0 flex-1 truncate">{model}</span>
                    <span className="text-muted-foreground">{t("pas encore de tarif fiable")}</span>
                  </li>
                ))}
              </ul>
            </FoldSection>
          </div>
        );
      }}
    </Async>
  );
}
