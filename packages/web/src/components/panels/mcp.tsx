import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "cn";
import { api } from "@/lib/api";
import type { McpStatus } from "@/lib/types";

const HEALTH = {
  connected: { label: "connecté", dot: "bg-emerald-500" },
  "needs-auth": { label: "authentification requise", dot: "bg-amber-500" },
  failed: { label: "en échec", dot: "bg-destructive" },
} as const;

/**
 * Interroge `claude mcp list`, qui teste chaque serveur.
 *
 * L'appel dure des secondes et n'est jamais lancé seul : les panneaux affichent
 * leur liste sans lui, et l'état vient se poser dessus quand on le demande.
 */
export function useMcpStatus(root: string) {
  const [statuses, setStatuses] = useState<McpStatus[]>();

  const check = async () => {
    const { status } = await api<{ status: McpStatus[] }>("/api/mcp/status", { root });
    setStatuses(status);
  };

  return {
    /** État par nom de serveur, connecteurs exclus — ils ne sont dans aucune configuration. */
    byName: statuses && new Map(statuses.filter((s) => !s.connector).map((s) => [s.name, s])),
    connectors: statuses?.filter((s) => s.connector),
    check,
  };
}

export function McpHealth({ status }: { status?: McpStatus }) {
  if (!status) return null;
  const { label, dot } = HEALTH[status.health];
  return (
    <Badge variant="outline" className="gap-1" title={status.detail}>
      <span className={cn("size-1.5 shrink-0 rounded-full", dot)} />
      {label}
    </Badge>
  );
}
