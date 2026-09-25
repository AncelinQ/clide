import { CheckCircle2, CircleAlert, CircleMinus, CloudDownload, LoaderCircle } from "lucide-react";
import { useSyncExternalStore } from "react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { t } from "@/i18n";
import { post, shortName } from "@/lib/api";

/** Sort d'un dépôt après un pull groupé, tel que le serveur le rend. */
export type PullOutcome =
  | { root: string; outcome: "updated"; branch: string; commits: number }
  | { root: string; outcome: "up-to-date"; branch: string }
  | { root: string; outcome: "skipped"; reason: "not-a-repo" | "detached" | "no-upstream" | "upstream-gone" }
  | { root: string; outcome: "error"; message: string };

interface PullState {
  running: boolean;
  /** Ce qui est en cours de mise à jour, pour le titre de la fenêtre. */
  label?: string;
  results?: PullOutcome[];
  error?: string;
  open: boolean;
}

let pull: PullState = { running: false, open: false };
const listeners = new Set<() => void>();

function setPull(next: Partial<PullState>): void {
  pull = { ...pull, ...next };
  for (const listener of listeners) listener();
}

function usePull(): PullState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => pull,
  );
}

export function usePullRunning(): boolean {
  return usePull().running;
}

/**
 * Tire des dépôts en avance rapide et ouvre le compte rendu.
 *
 * Un seul pull groupé à la fois : relancer pendant qu'un autre tourne ne ferait
 * que se battre avec lui pour les mêmes dépôts.
 */
export async function pullRepositories(roots: string[], options: { withLinks?: boolean; label: string }): Promise<void> {
  if (pull.running || roots.length === 0) return;
  setPull({ running: true, open: true, label: options.label, results: undefined, error: undefined });
  try {
    const { results } = await post<{ results: PullOutcome[] }>("/api/git/pull-many", {
      roots,
      withLinks: options.withLinks === true,
    });
    setPull({ results });
  } catch (caught) {
    setPull({ error: (caught as Error).message });
  } finally {
    setPull({ running: false });
  }
}

const SKIP_REASON: Record<Extract<PullOutcome, { outcome: "skipped" }>["reason"], string> = {
  "not-a-repo": "pas un dépôt git",
  detached: "HEAD détaché",
  "no-upstream": "branche sans amont",
  "upstream-gone": "la branche distante a été supprimée (MR fusionnée ?) : repasser sur la branche principale",
};

function OutcomeLine({ result }: { result: PullOutcome }) {
  const [Icon, tone, text] =
    result.outcome === "updated"
      ? [
          CloudDownload,
          "text-primary",
          t(result.commits === 1 ? "{branch} : {count} commit récupéré" : "{branch} : {count} commits récupérés", {
            branch: result.branch,
            count: result.commits,
          }),
        ]
      : result.outcome === "up-to-date"
        ? [CheckCircle2, "text-muted-foreground", t("{branch} : déjà à jour", { branch: result.branch })]
        : result.outcome === "skipped"
          ? [CircleMinus, "text-muted-foreground", t("ignoré : {reason}", { reason: t(SKIP_REASON[result.reason]) })]
          : [CircleAlert, "text-destructive", result.message];

  return (
    <li className="flex gap-2 py-1.5">
      <Icon className={`mt-0.5 size-4 shrink-0 ${tone}`} />
      <div className="min-w-0">
        <div className="font-medium" title={result.root}>
          {shortName(result.root)}
        </div>
        <div className={`text-[11px] break-words whitespace-pre-wrap ${result.outcome === "error" ? "text-destructive" : "text-muted-foreground"}`}>
          {text}
        </div>
      </div>
    </li>
  );
}

/** Compte rendu du dernier pull groupé. Monté une fois, ouvert par `pullRepositories`. */
export function PullReportDialog() {
  const state = usePull();
  const results = state.results ?? [];
  const updated = results.filter((result) => result.outcome === "updated").length;
  const failed = results.filter((result) => result.outcome === "error").length;

  return (
    <Dialog open={state.open} onOpenChange={(open) => setPull({ open })}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{state.label ?? t("Mise à jour")}</DialogTitle>
          <DialogDescription>
            {state.running
              ? t("git pull en avance rapide, dépôt par dépôt…")
              : t("{updated} mis à jour, {failed} en échec, sur {total}.", {
                  updated,
                  failed,
                  total: results.length,
                })}
          </DialogDescription>
        </DialogHeader>
        {state.running && (
          <div className="flex items-center gap-2 py-2 text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" /> {t("En cours…")}
          </div>
        )}
        {state.error && <p className="text-destructive">{state.error}</p>}
        {results.length > 0 && (
          <ul className="max-h-[60vh] divide-y overflow-y-auto">
            {results.map((result) => (
              <OutcomeLine key={result.root} result={result} />
            ))}
          </ul>
        )}
        {failed > 0 && (
          <p className="text-[11px] text-muted-foreground">
            {t("Un pull en échec n'a rien modifié : avance rapide seulement, sans fusion ni rebase.")}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
