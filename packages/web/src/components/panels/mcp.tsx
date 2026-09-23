import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import type { McpStatus } from "@/lib/types";
import { useStore } from "@/state/store";
import { claudeTabFor, sendToClaude } from "@/state/terminals";

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

/**
 * État d'un serveur, et le moyen de l'authentifier quand il le demande.
 *
 * L'authentification se fait dans Claude Code, par `/mcp` : le bouton l'envoie à
 * l'onglet Claude du projet plutôt que de laisser chercher la commande.
 */
export function McpHealth({ status }: { status?: McpStatus }) {
  // Relu à chaque changement d'onglets : le bouton n'a de sens qu'avec un
  // onglet Claude où envoyer la commande.
  const claudeTab = useStore((state) => claudeTabFor(state.activeRoot));
  if (!status) return null;
  const { label, dot } = HEALTH[status.health];
  return (
    <>
      <Badge variant="outline" className="gap-1" title={status.detail}>
        <span className={cn("size-1.5 shrink-0 rounded-full", dot)} />
        {t(label)}
      </Badge>
      {status.health === "needs-auth" && (
        <Button
          variant="outline"
          size="sm"
          className="h-5 px-1.5 font-mono text-[10px]"
          disabled={!claudeTab}
          title={claudeTab ? t("Envoyer /mcp à l'onglet Claude") : t("Ouvre un onglet Claude pour authentifier")}
          onClick={() => sendToClaude("/mcp")}
        >
          /mcp
        </Button>
      )}
    </>
  );
}
