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
import { api, formatDate, post } from "@/lib/api";
import { cn } from "cn";

interface RestorePlan {
  absolutePath: string;
  action: "overwrite" | "recreate" | "remove";
  binary: boolean;
  unified: string;
  currentHash: string;
  lastWrite?: string;
  blocked?: string;
}

const ACTION_LABEL: Record<RestorePlan["action"], string> = {
  overwrite: "Le fichier reprend son contenu d'avant la session. Le contenu actuel est copié dans les données de l'application.",
  recreate: "Le fichier, disparu depuis, est réécrit tel qu'il était avant la session.",
  remove: "La session a créé ce fichier : il part à la corbeille de Windows.",
};

/** Diff unifié coloré : ajouts en vert, retraits en rouge. */
export function DiffLines({ unified, className }: { unified: string; className?: string }) {
  return (
    <pre
      className={cn(
        "overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed",
        className,
      )}
    >
      {unified.split("\n").map((line, index) => (
        <span
          key={index}
          className={cn(
            "block",
            line.startsWith("+") && "text-emerald-600 dark:text-emerald-400",
            line.startsWith("-") && "text-destructive",
            line.startsWith("@@") && "text-primary",
          )}
        >
          {line}
        </span>
      ))}
    </pre>
  );
}

/**
 * Restauration d'un fichier à son état d'avant la session, après avoir montré ce
 * qu'elle écrase.
 *
 * Le serveur refuse un fichier modifié après la dernière écriture de la session,
 * une session qui tourne encore, ou un fichier qui a bougé depuis cet aperçu ; il
 * rend la raison, et le bouton reste inactif.
 */
export function FileRestoreDialog({
  sessionId,
  trackingPath,
  onClose,
  onRestored,
}: {
  sessionId: string;
  trackingPath: string;
  onClose: () => void;
  onRestored: () => void;
}) {
  const state = useAsync(
    () => api<RestorePlan>("/api/session/restore-plan", { id: sessionId, path: trackingPath }),
    [sessionId, trackingPath],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [backup, setBackup] = useState<string | null>();

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("Restaurer le fichier")}</DialogTitle>
          <DialogDescription className="font-mono text-[11px] break-all">{trackingPath}</DialogDescription>
        </DialogHeader>
        <Async state={state}>
          {(plan) =>
            backup !== undefined ? (
              <div className="grid gap-2 text-[12px]">
                <p>{t("Fichier restauré.")}</p>
                {backup && (
                  <p className="text-muted-foreground">
                    {t("Le contenu remplacé est gardé dans {path}.", { path: backup })}
                  </p>
                )}
                <DialogFooter>
                  <Button onClick={onClose}>{t("Fermer")}</Button>
                </DialogFooter>
              </div>
            ) : (
              <div className="grid min-w-0 gap-2 text-[12px]">
                <p>{t(ACTION_LABEL[plan.action])}</p>
                {plan.lastWrite && (
                  <p className="text-[11px] text-muted-foreground">
                    {t("Dernière écriture de la session : {date}.", { date: formatDate(plan.lastWrite) })}
                  </p>
                )}
                {plan.binary ? (
                  <p className="text-muted-foreground">{t("Fichier binaire : pas d'aperçu.")}</p>
                ) : (
                  plan.unified && (
                    <>
                      <p className="text-[11px] text-muted-foreground">
                        {t("En rouge ce qui sera perdu, en vert ce qui revient.")}
                      </p>
                      <DiffLines unified={plan.unified} className="max-h-96" />
                    </>
                  )
                )}
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
                        const result = await post<{ backup?: string }>("/api/session/restore", {
                          id: sessionId,
                          path: trackingPath,
                          hash: plan.currentHash,
                        });
                        setBackup(result.backup ?? null);
                        onRestored();
                      } catch (caught) {
                        setError((caught as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {t("Restaurer")}
                  </Button>
                </DialogFooter>
              </div>
            )
          }
        </Async>
      </DialogContent>
    </Dialog>
  );
}
