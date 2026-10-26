/** Incident en cours sur la page de statut. */
export interface ServiceIncident {
  name: string;
  /** `investigating`, `identified`, `monitoring`… */
  status: string;
  /** `none`, `minor`, `major` ou `critical`. */
  impact: string;
  /** Page de l'incident, seulement en `https:` : le client l'ouvre telle quelle. */
  url?: string;
  updatedAt?: string;
}

/** Ce que montre l'onglet : l'état d'ensemble, puis ce qui ne va pas. */
export interface ServiceStatus {
  /** `none`, `minor`, `major`, `critical` ou `maintenance`. */
  indicator: string;
  description: string;
  /** Composants qui ne sont pas opérationnels. */
  degraded: { name: string; status: string }[];
  /** Incidents ni résolus ni clos par un post-mortem. */
  incidents: ServiceIncident[];
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

/** Vide plutôt qu'absent : les textes de la page s'affichent tels quels. */
const text = (value: unknown): string => (typeof value === "string" ? value : "");

const records = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.map(asRecord).filter((item): item is Record<string, unknown> => item !== undefined) : [];

function httpsUrl(value: unknown): string | undefined {
  const raw = text(value);
  try {
    return new URL(raw).protocol === "https:" ? raw : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Lit le `summary.json` d'une page Statuspage.
 *
 * Un composant de groupe n'est qu'un titre : son état répète celui de ses
 * composants, qui sont gardés à sa place.
 */
export function parseStatusPage(body: unknown): ServiceStatus {
  const page = asRecord(body);
  const status = asRecord(page?.["status"]);
  const indicator = text(status?.["indicator"]);
  if (!indicator) throw new Error("page de statut illisible");

  const degraded = records(page?.["components"])
    .filter((component) => component["group"] !== true && text(component["status"]) && component["status"] !== "operational")
    .map((component) => ({ name: text(component["name"]), status: text(component["status"]) }));

  const incidents = records(page?.["incidents"])
    .filter((incident) => incident["status"] !== "resolved" && incident["status"] !== "postmortem")
    .map((incident): ServiceIncident => {
      const url = httpsUrl(incident["shortlink"]);
      const updatedAt = text(incident["updated_at"]);
      return {
        name: text(incident["name"]),
        status: text(incident["status"]),
        impact: text(incident["impact"]),
        ...(url ? { url } : {}),
        ...(updatedAt ? { updatedAt } : {}),
      };
    });

  return { indicator, description: text(status?.["description"]), degraded, incidents };
}
