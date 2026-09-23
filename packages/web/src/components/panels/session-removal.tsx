import { useState } from "react";

import { Async, useAsync } from "@/components/common";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { t } from "@/i18n";
import { api, post } from "@/lib/api";

interface RemovalPlan {
  title?: string;
  artifacts: { role: "transcript" | "subagents" | "file-history" | "session-env"; size: number; path: string }[];
  blocked?: string;
}

const ROLE_LABEL: Record<RemovalPlan["artifacts"][number]["role"], string> = {
  transcript: "transcript",
  subagents: "sous-agents",
  "file-history": "sauvegardes de fichiers",
  "session-env": "environnement",
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return t("{size} o", { size: bytes });
  if (bytes < 1024 * 1024) return t("{size} Ko", { size: (bytes / 1024).toFixed(1).replace(".", ",") });
  return t("{size} Mo", { size: (bytes / 1024 / 1024).toFixed(1).replace(".", ",") });
}

/**
 * Retrait d'une session, après avoir montré ce qui partira.
 *
 * Tout part à la corbeille de Windows, d'où l'on restaure : rien n'est supprimé.
 * Une session suivie par un onglet ou active il y a peu est refusée par le
 * serveur, qui rend la raison ; le bouton reste alors inactif.
 */
export function SessionRemovalDialog({
  sessionId,
  onClose,
  onRemoved,
}: {
  sessionId: string;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const state = useAsync(() => api<RemovalPlan>("/api/session/removal", { id: sessionId }), [sessionId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Retirer la session")}</DialogTitle>
          <DialogDescription>{t("Tout part à la corbeille de Windows, d'où l'on peut le restaurer.")}</DialogDescription>
        </DialogHeader>
        <Async state={state}>
          {(plan) => (
            <div className="grid gap-2 text-[12px]">
              <p className="font-medium">{plan.title ?? sessionId}</p>
              <ul className="m-0 grid list-none gap-1 p-0">
                {plan.artifacts.map((artifact) => (
                  <li key={artifact.path} className="flex items-baseline gap-2">
                    <span className="w-40 shrink-0 text-muted-foreground">{t(ROLE_LABEL[artifact.role])}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={artifact.path}>
                      {artifact.path}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{formatSize(artifact.size)}</span>
                  </li>
                ))}
              </ul>
              {plan.blocked && <p className="text-destructive">{t("Impossible : {reason}.", { reason: plan.blocked })}</p>}
              {error && <p className="text-destructive">{error}</p>}
              <DialogFooter>
                <Button variant="outline" onClick={onClose}>
                  {t("Annuler")}
                </Button>
                <Button
                  variant="destructive"
                  disabled={Boolean(plan.blocked) || busy}
                  onClick={async () => {
                    setBusy(true);
                    setError(undefined);
                    try {
                      await post("/api/sessions/delete", { id: sessionId });
                      onRemoved();
                      onClose();
                    } catch (caught) {
                      setError((caught as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {t("Mettre à la corbeille")}
                </Button>
              </DialogFooter>
            </div>
          )}
        </Async>
      </DialogContent>
    </Dialog>
  );
}
