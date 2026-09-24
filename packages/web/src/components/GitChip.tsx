import { ArrowDown, ArrowUp, ArchiveRestore, CloudDownload, GitBranch, GitBranchPlus, RefreshCw, Upload } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { BranchDialog } from "@/components/BranchDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { t } from "@/i18n";
import { api, post } from "@/lib/api";
import { cn } from "cn";

export interface GitStatus {
  branch?: string;
  head?: string;
  upstream?: string;
  ahead: number;
  behind: number;
  changed: number;
  conflicted: number;
}

interface PushPlan {
  branch: string;
  head: string;
  remote: string;
  target: string;
  setUpstream: boolean;
  commits: { hash: string; subject: string }[];
  blocked?: string;
}

/**
 * État git d'un dossier, relevé toutes les dix secondes et au retour sur la
 * fenêtre : un commit fait par Claude dans un terminal doit se voir sans rien
 * cliquer.
 */
export function useGitStatus(root: string | undefined) {
  const [status, setStatus] = useState<(GitStatus & { stashes: number }) | null>(null);
  const refresh = useCallback(() => {
    if (!root) return Promise.resolve();
    return api<{ status: GitStatus | null; stashes: number }>("/api/git/status", { root })
      .then((result) => setStatus(result.status ? { ...result.status, stashes: result.stashes } : null))
      .catch(() => setStatus(null));
  }, [root]);
  useEffect(() => {
    setStatus(null);
    void refresh();
    const timer = setInterval(refresh, 10_000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);
  return [status, refresh] as const;
}

/**
 * Ce qu'un push enverrait, à valider avant qu'il ne parte : un push est un geste
 * sortant, qu'on ne rattrape pas. Le serveur refuse si la branche a bougé depuis
 * cet aperçu.
 */
function PushDialog({ root, onClose, onDone }: { root: string; onClose: () => void; onDone: () => void }) {
  const [plan, setPlan] = useState<PushPlan>();
  const [error, setError] = useState<string>();
  const [pushing, setPushing] = useState(false);

  useEffect(() => {
    api<PushPlan>("/api/git/push-plan", { root })
      .then(setPlan)
      .catch((caught: Error) => setError(caught.message));
  }, [root]);

  const push = async () => {
    if (!plan) return;
    setPushing(true);
    setError(undefined);
    try {
      await post("/api/git/push", { root, head: plan.head });
      onDone();
      onClose();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setPushing(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Pousser {branch}", { branch: plan?.branch ?? "…" })}</DialogTitle>
          <DialogDescription>
            {plan
              ? plan.setUpstream
                ? t("Vers {remote}/{target}, une branche distante qui n'existe pas encore : elle sera créée et suivie.", {
                    remote: plan.remote,
                    target: plan.target,
                  })
                : t("Vers {remote}/{target}.", { remote: plan.remote, target: plan.target })
              : t("Lecture de ce qui partirait…")}
          </DialogDescription>
        </DialogHeader>
        {plan && plan.commits.length > 0 && (
          <div className="grid gap-1">
            <div className="text-[11px] text-muted-foreground">
              {t("{count} commit(s) partiront :", { count: plan.commits.length })}
            </div>
            <ul className="m-0 max-h-64 list-none overflow-auto rounded-md border p-0 font-mono text-[11.5px]">
              {plan.commits.map((entry) => (
                <li key={entry.hash} className="flex gap-2 border-b px-2 py-1 last:border-0">
                  <span className="shrink-0 text-muted-foreground">{entry.hash}</span>
                  <span className="truncate" title={entry.subject}>
                    {entry.subject}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {plan?.setUpstream && plan.commits.length === 0 && (
          <p className="text-[12px] text-muted-foreground">
            {t("Aucun commit nouveau : seule la branche distante sera créée.")}
          </p>
        )}
        {(plan?.blocked ?? error) && <p className="text-[12px] text-destructive">{plan?.blocked ?? error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("Annuler")}
          </Button>
          <Button disabled={!plan || !!plan.blocked || pushing} onClick={() => void push()}>
            <Upload />
            {pushing
              ? t("Envoi…")
              : plan?.commits.length
                ? t("Pousser {count} commit(s)", { count: plan.commits.length })
                : t("Pousser")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * La branche du projet ouvert, toujours visible, avec l'écart à son amont et les
 * fichiers touchés, et les gestes courants : fetch, pull en avance rapide, push.
 */
export function GitChip({ root }: { root: string }) {
  const [status, refresh] = useGitStatus(root);
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState<{ text: string; error: boolean }>();
  const [pushing, setPushing] = useState(false);
  const [branching, setBranching] = useState(false);

  if (!status) return null;

  const act = async (label: string, path: string) => {
    setBusy(label);
    setMessage(undefined);
    try {
      await post(path, { root });
      setMessage({ text: t("{action} : fait.", { action: label }), error: false });
    } catch (caught) {
      setMessage({ text: (caught as Error).message, error: true });
    } finally {
      setBusy(undefined);
      void refresh();
    }
  };

  const name = status.branch ?? (status.head ? t("détaché {head}", { head: status.head }) : t("dépôt vide"));
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title={status.upstream ? t("{branch}, suit {upstream}", { branch: name, upstream: status.upstream }) : name}
            className={cn(
              "flex max-w-72 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] hover:bg-accent",
              message?.error && "border-destructive/60",
            )}
          >
            <GitBranch className={cn("size-3.5 shrink-0", busy && "animate-pulse")} />
            <span className="truncate font-mono">{name}</span>
            {status.ahead > 0 && (
              <span className="flex items-center tabular-nums text-primary">
                <ArrowUp className="size-3" />
                {status.ahead}
              </span>
            )}
            {status.behind > 0 && (
              <span className="flex items-center tabular-nums text-amber-600">
                <ArrowDown className="size-3" />
                {status.behind}
              </span>
            )}
            {status.changed + status.conflicted > 0 && (
              <span
                className={cn("tabular-nums", status.conflicted > 0 ? "text-destructive" : "text-muted-foreground")}
                title={t("{count} fichier(s) touché(s)", { count: status.changed + status.conflicted })}
              >
                ●{status.changed + status.conflicted}
              </span>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="w-72">
          <DropdownMenuLabel className="truncate font-mono text-[11px] font-normal text-muted-foreground">
            {status.upstream ? t("suit {upstream}", { upstream: status.upstream }) : t("sans branche distante")}
          </DropdownMenuLabel>
          {message && (
            <div className={cn("px-2 pb-1 text-[11px]", message.error ? "text-destructive" : "text-muted-foreground")}>
              {message.text}
            </div>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!!busy} onSelect={() => void act(t("Fetch"), "/api/git/fetch")}>
            <RefreshCw /> {t("Fetch")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!!busy || !status.upstream}
            onSelect={() => void act(t("Pull"), "/api/git/pull")}
          >
            <CloudDownload /> {t("Pull (avance rapide)")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!!busy || !status.branch} onSelect={() => setPushing(true)}>
            <Upload /> {t("Push…")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!!busy} onSelect={() => setBranching(true)}>
            <GitBranchPlus /> {t("Branches et worktrees…")}
          </DropdownMenuItem>
          {status.stashes > 0 && (
            <DropdownMenuItem disabled={!!busy} onSelect={() => void act(t("Stash réappliqué"), "/api/git/stash-pop")}>
              <ArchiveRestore /> {t("Réappliquer le dernier stash ({count})", { count: status.stashes })}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {branching && (
        <BranchDialog
          root={root}
          {...(status.branch ? { current: status.branch } : {})}
          onClose={() => setBranching(false)}
          onDone={(text) => {
            setMessage({ text, error: false });
            void refresh();
          }}
        />
      )}
      {pushing && (
        <PushDialog
          root={root}
          onClose={() => setPushing(false)}
          onDone={() => {
            setMessage({ text: t("Push : fait."), error: false });
            void refresh();
          }}
        />
      )}
    </>
  );
}
