/** Page de statut d'Anthropic, ouverte dans le navigateur. */
export const STATUS_PAGE = "https://status.claude.com";

export type StatusTone = "ok" | "warn" | "error";

/** Gravité d'un état d'ensemble : la maintenance et la gêne mineure ne sont pas des pannes. */
export function statusTone(indicator: string): StatusTone {
  if (indicator === "none") return "ok";
  return indicator === "minor" || indicator === "maintenance" ? "warn" : "error";
}

const LABELS: Readonly<Record<string, string>> = {
  operational: "opérationnel",
  degraded_performance: "ralenti",
  partial_outage: "panne partielle",
  major_outage: "panne majeure",
  under_maintenance: "maintenance",
  investigating: "analyse en cours",
  identified: "cause identifiée",
  monitoring: "sous surveillance",
};

/**
 * Libellé français d'un état de composant ou d'incident, à passer à `t()`. Un
 * état que la page ajouterait s'affiche tel quel, lisible.
 */
export function statusLabel(status: string): string {
  return LABELS[status] ?? status.replace(/_/g, " ");
}

/** Raison d'un échec de la page de statut, en texte et valeurs pour `t()`. */
export function statusErrorText(error: string): { text: string; values: Record<string, string> } {
  const network = /^réseau injoignable \((.+)\)$/.exec(error);
  if (network) return { text: "réseau injoignable ({code})", values: { code: network[1] ?? "" } };
  return { text: error, values: {} };
}
