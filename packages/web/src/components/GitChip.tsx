import {
  ArrowDown,
  ArrowUp,
  ArchiveRestore,
  ArrowDownUp,
  CloudDownload,
  ExternalLink,
  GitBranch,
  GitBranchPlus,
  GitPullRequest,
  RefreshCw,
  Upload,
} from "lucide-react";
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
  untracked: number;
  conflicted: number;
  /** La branche distante suivie a été supprimée. */
  upstreamGone?: boolean;
}

interface PushPlan {
  branch: string;
  head: string;
  remote: string;
  target: string;
  setUpstream: boolean;
  commits: { hash: string; subject: string }[];
  blocked?: string;
  diverged: boolean;
  overwritten: { hash: string; subject: string }[];
  remoteHead?: string;
}

/**
 * Ce qui attend dans un dépôt, en signes compacts : fichiers à committer,
 * commits à pousser ou en retard, divergence. Rien quand tout est à jour.
 */
export function GitMarks({ status, className }: { status: GitStatus; className?: string }) {
  const touched = status.changed + status.untracked + status.conflicted;
  const diverged = status.ahead > 0 && status.behind > 0;
  if (touched === 0 && status.ahead === 0 && status.behind === 0 && !status.upstreamGone) return null;
  return (
    <span
      className={cn("flex items-center gap-1 text-[10.5px] tabular-nums", className)}
      title={pendingSummary(status)}
    >
      {touched > 0 && (
        <span className={status.conflicted > 0 ? "text-destructive" : "text-muted-foreground"}>●{touched}</span>
      )}
      {status.upstreamGone && <span className="text-amber-600">{t("distante supprimée")}</span>}
      {diverged ? (
        <span className="flex items-center text-destructive">
          <ArrowDownUp className="size-3" />
        </span>
      ) : (
        <>
          {status.ahead > 0 && (
            <span className="flex items-center text-primary">
              <ArrowUp className="size-3" />
              {status.ahead}
            </span>
          )}
          {status.behind > 0 && (
            <span className="flex items-center text-amber-600">
              <ArrowDown className="size-3" />
              {status.behind}
            </span>
          )}
        </>
      )}
    </span>
  );
}

/** Indicateurs git d'un dossier, relevés comme ceux de la puce de branche. */
export function RepoMarks({ root, className }: { root: string; className?: string }) {
  const [status] = useGitStatus(root);
  return status ? <GitMarks status={status} {...(className ? { className } : {})} /> : null;
}

/** Branches qu'un push forcé ne devrait presque jamais viser. */
const MAIN_BRANCHES = new Set(["main", "master", "develop", "trunk"]);

/** Liste de commits, hash et sujet, dans une boîte qui défile. */
function CommitList({ commits, tone }: { commits: { hash: string; subject: string }[]; tone?: "danger" }) {
  return (
    <ul
      className={cn(
        "m-0 max-h-48 list-none overflow-auto rounded-md border p-0 font-mono text-[11.5px]",
        tone === "danger" && "border-destructive/50",
      )}
    >
      {commits.map((entry) => (
        <li key={entry.hash} className="flex gap-2 border-b px-2 py-1 last:border-0">
          <span className="shrink-0 text-muted-foreground">{entry.hash}</span>
          <span className="truncate" title={entry.subject}>
            {entry.subject}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Résumé de ce qui attend, pour l'infobulle d'un indicateur git. */
export function pendingSummary(status: GitStatus): string {
  const parts: string[] = [];
  const touched = status.changed + status.untracked + status.conflicted;
  if (touched > 0) parts.push(t("{count} fichier(s) à committer", { count: touched }));
  if (status.upstreamGone) {
    parts.push(
      t("la branche distante {upstream} a été supprimée (MR fusionnée ?)", { upstream: status.upstream ?? "" }),
    );
  }
  if (status.conflicted > 0) parts.push(t("{count} en conflit", { count: status.conflicted }));
  if (status.ahead > 0 && status.behind > 0) {
    parts.push(
      t("a divergé : {ahead} à pousser, {behind} distants — push forcé nécessaire", {
        ahead: status.ahead,
        behind: status.behind,
      }),
    );
  } else {
    if (status.ahead > 0) parts.push(t("{count} commit(s) à pousser", { count: status.ahead }));
    if (status.behind > 0) parts.push(t("{count} commit(s) en retard", { count: status.behind }));
  }
  if (!status.upstream && status.branch) parts.push(t("jamais poussée"));
  return parts.length > 0 ? parts.join(" · ") : t("à jour");
}

type StatusWithStashes = GitStatus & { stashes: number };

/**
 * Dernier état connu de chaque dossier. Revenir sur un projet le montre aussitôt,
 * en attendant le relevé : sans lui, la puce de la barre de titre manque le temps
 * de `git status`, et tout ce que la barre centre glisse puis revient.
 */
const knownStatus = new Map<string, StatusWithStashes | null>();

/**
 * État git d'un dossier, relevé toutes les dix secondes et au retour sur la
 * fenêtre : un commit fait par Claude dans un terminal doit se voir sans rien
 * cliquer.
 */
export function useGitStatus(root: string | undefined) {
  const [status, setStatus] = useState<StatusWithStashes | null>(() => (root ? (knownStatus.get(root) ?? null) : null));
  const refresh = useCallback(() => {
    if (!root) return Promise.resolve();
    const keep = (next: StatusWithStashes | null) => {
      knownStatus.set(root, next);
      setStatus(next);
    };
    return api<{ status: GitStatus | null; stashes: number }>("/api/git/status", { root })
      .then((result) => keep(result.status ? { ...result.status, stashes: result.stashes } : null))
      .catch(() => keep(null));
  }, [root]);
  useEffect(() => {
    setStatus(root ? (knownStatus.get(root) ?? null) : null);
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

interface Review {
  forge: "github" | "gitlab";
  number: number;
  title: string;
  state: "open" | "draft" | "merged" | "closed";
  url: string;
  ci?: "success" | "failed" | "running" | "pending" | "canceled" | "skipped";
  ciUrl?: string;
  review?: "approved" | "changes_requested" | "review_required";
}

/**
 * MR ou PR de la branche, relevée à la minute : le serveur la tient d'une CLI qui
 * interroge la forge, et garde sa réponse le même temps.
 */
type ReviewState = { review: Review | null; error?: string };

/** Dernière MR connue de chaque branche, par `dossier|branche` : la puce ne s'élargit pas après coup. */
const knownReview = new Map<string, ReviewState>();

function useReview(root: string, branch: string | undefined) {
  const key = `${root}|${branch ?? ""}`;
  const [state, setState] = useState<ReviewState>(() => knownReview.get(key) ?? { review: null });
  useEffect(() => {
    if (!branch) {
      setState({ review: null });
      return;
    }
    setState(knownReview.get(key) ?? { review: null });
    let alive = true;
    const keep = (next: ReviewState) => {
      knownReview.set(key, next);
      if (alive) setState(next);
    };
    const poll = () =>
      api<ReviewState>("/api/git/review", { root })
        .then(keep)
        .catch(() => keep({ review: null }));
    void poll();
    const timer = setInterval(poll, 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [root, branch, key]);
  return state;
}

const CI_DOT: Record<NonNullable<Review["ci"]>, string> = {
  success: "bg-emerald-500",
  failed: "bg-destructive",
  running: "animate-pulse bg-amber-500",
  pending: "bg-muted-foreground",
  canceled: "bg-muted-foreground",
  skipped: "bg-muted-foreground",
};

const CI_LABEL: Record<NonNullable<Review["ci"]>, string> = {
  success: "CI verte",
  failed: "CI en échec",
  running: "CI en cours",
  pending: "CI en attente",
  canceled: "CI annulée",
  skipped: "CI ignorée",
};

const STATE_LABEL: Record<Review["state"], string> = {
  open: "ouverte",
  draft: "brouillon",
  merged: "fusionnée",
  closed: "fermée",
};

const REVIEW_LABEL: Record<NonNullable<Review["review"]>, string> = {
  approved: "approuvée",
  changes_requested: "changements demandés",
  review_required: "relecture attendue",
};

/**
 * Ce qu'un push enverrait, à valider avant qu'il ne parte : un push est un geste
 * sortant, qu'on ne rattrape pas. Le serveur refuse si la branche a bougé depuis
 * cet aperçu.
 */
export function PushDialog({ root, onClose, onDone }: { root: string; onClose: () => void; onDone: () => void }) {
  const [plan, setPlan] = useState<PushPlan>();
  const [error, setError] = useState<string>();
  const [pushing, setPushing] = useState(false);
  // Un push forcé se confirme en deux temps : il efface des commits distants.
  const [armed, setArmed] = useState(false);

  // Un fetch d'abord : l'aperçu compare à l'état réel du dépôt distant, pas au
  // dernier connu. Hors ligne, il compare au dernier connu.
  useEffect(() => {
    let alive = true;
    post("/api/git/fetch", { root })
      .catch(() => undefined)
      .then(() => api<PushPlan>("/api/git/push-plan", { root }))
      .then((result) => alive && setPlan(result))
      .catch((caught: Error) => alive && setError(caught.message));
    return () => {
      alive = false;
    };
  }, [root]);

  const push = async (force: boolean) => {
    if (!plan) return;
    setPushing(true);
    setError(undefined);
    try {
      await post("/api/git/push", {
        root,
        head: plan.head,
        ...(force && plan.remoteHead ? { forceOver: plan.remoteHead } : {}),
      });
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
              : t("Récupération de l'état distant, puis lecture de ce qui partirait…")}
          </DialogDescription>
        </DialogHeader>
        {plan && plan.commits.length > 0 && (
          <div className="grid gap-1">
            <div className="text-[11px] text-muted-foreground">
              {t("{count} commit(s) partiront :", { count: plan.commits.length })}
            </div>
            <CommitList commits={plan.commits} />
          </div>
        )}
        {plan?.diverged && (
          <div className="grid gap-1">
            <div className="text-[11px] font-medium text-destructive">
              {t("Un push forcé effacerait ces {count} commit(s) de {remote}/{target} :", {
                count: plan.overwritten.length,
                remote: plan.remote,
                target: plan.target,
              })}
            </div>
            <CommitList commits={plan.overwritten} tone="danger" />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {t(
                "Forcé avec --force-with-lease : si quelqu'un pousse d'ici là, le push est refusé au lieu d'effacer son travail.",
              )}
              {MAIN_BRANCHES.has(plan.target) && (
                <strong className="text-destructive">
                  {" "}
                  {t("{target} est une branche principale : elle est souvent partagée, et parfois protégée.", {
                    target: plan.target,
                  })}
                </strong>
              )}
            </p>
          </div>
        )}
        {plan?.setUpstream && plan.commits.length === 0 && (
          <p className="text-[12px] text-muted-foreground">
            {t("Aucun commit nouveau : seule la branche distante sera créée.")}
          </p>
        )}
        {(error ?? (plan?.diverged ? undefined : plan?.blocked)) && (
          <p className="text-[12px] text-destructive">{error ?? plan?.blocked}</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("Annuler")}
          </Button>
          {plan?.diverged ? (
            <Button
              variant="destructive"
              disabled={pushing || !plan.remoteHead}
              onClick={() => (armed ? void push(true) : setArmed(true))}
            >
              <Upload />
              {pushing
                ? t("Envoi…")
                : armed
                  ? t("Confirmer : écraser {count} commit(s)", { count: plan.overwritten.length })
                  : t("Forcer le push…")}
            </Button>
          ) : (
            <Button disabled={!plan || !!plan.blocked || pushing} onClick={() => void push(false)}>
              <Upload />
              {pushing
                ? t("Envoi…")
                : plan?.commits.length
                  ? t("Pousser {count} commit(s)", { count: plan.commits.length })
                  : t("Pousser")}
            </Button>
          )}
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
  const { review, error: reviewError } = useReview(root, status?.branch);

  if (!status) return null;
  const tag = review ? `${review.forge === "github" ? "#" : "!"}${review.number}` : undefined;

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
            title={[
              status.upstream ? t("{branch}, suit {upstream}", { branch: name, upstream: status.upstream }) : name,
              pendingSummary(status),
            ].join("\n")}
            className={cn(
              "flex min-w-28 max-w-72 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] hover:bg-accent",
              message?.error && "border-destructive/60",
            )}
          >
            <GitBranch className={cn("size-3.5 shrink-0", busy && "animate-pulse")} />
            <span className="truncate font-mono">{name}</span>
            {status.ahead > 0 && status.behind > 0 && (
              <span className="flex shrink-0 items-center gap-0.5 tabular-nums text-destructive">
                <ArrowDownUp className="size-3" />
                {t("divergée")}
              </span>
            )}
            {status.ahead > 0 && (
              <span className="flex shrink-0 items-center tabular-nums text-primary">
                <ArrowUp className="size-3" />
                {status.ahead}
              </span>
            )}
            {status.behind > 0 && (
              <span className="flex shrink-0 items-center tabular-nums text-amber-600">
                <ArrowDown className="size-3" />
                {status.behind}
              </span>
            )}
            {review && tag && (
              <span className="flex shrink-0 items-center gap-1 tabular-nums text-muted-foreground">
                <GitPullRequest className="size-3" />
                {tag}
                {review.ci && <span className={cn("size-1.5 rounded-full", CI_DOT[review.ci])} />}
              </span>
            )}
            {status.changed + status.untracked + status.conflicted > 0 && (
              <span
                className={cn("shrink-0 tabular-nums", status.conflicted > 0 ? "text-destructive" : "text-muted-foreground")}
                title={t("{count} fichier(s) touché(s)", {
                  count: status.changed + status.untracked + status.conflicted,
                })}
              >
                ●{status.changed + status.untracked + status.conflicted}
              </span>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="w-72">
          <DropdownMenuLabel className="truncate font-mono text-[11px] font-normal text-muted-foreground">
            {status.upstream ? t("suit {upstream}", { upstream: status.upstream }) : t("sans branche distante")}
          </DropdownMenuLabel>
          <div className="px-2 pb-1 text-[11px] text-muted-foreground">{pendingSummary(status)}</div>
          {message && (
            <div className={cn("px-2 pb-1 text-[11px]", message.error ? "text-destructive" : "text-muted-foreground")}>
              {message.text}
            </div>
          )}
          {review && tag && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => window.open(review.url, "_blank", "noreferrer")}>
                <GitPullRequest />
                <span className="min-w-0 flex-1 truncate" title={review.title}>
                  {tag} · {t(STATE_LABEL[review.state])}
                  {review.review ? ` · ${t(REVIEW_LABEL[review.review])}` : ""}
                </span>
                <ExternalLink className="opacity-60" />
              </DropdownMenuItem>
              {review.ci && (
                <DropdownMenuItem
                  disabled={!review.ciUrl && review.forge === "gitlab"}
                  onSelect={() => window.open(review.ciUrl ?? `${review.url}/checks`, "_blank", "noreferrer")}
                >
                  <span className={cn("mx-1 size-2 rounded-full", CI_DOT[review.ci])} />
                  <span className="flex-1">{t(CI_LABEL[review.ci])}</span>
                  <ExternalLink className="opacity-60" />
                </DropdownMenuItem>
              )}
            </>
          )}
          {reviewError && <div className="px-2 pb-1 text-[11px] text-muted-foreground">{reviewError}</div>}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!!busy} onSelect={() => void act(t("Fetch"), "/api/git/fetch")}>
            <RefreshCw /> {t("Fetch")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!!busy || !status.upstream || status.upstreamGone === true}
            onSelect={() => void act(t("Pull"), "/api/git/pull")}
          >
            <CloudDownload /> {t("Pull (avance rapide)")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!!busy || !status.branch} onSelect={() => setPushing(true)}>
            <Upload /> {status.ahead > 0 && status.behind > 0 ? t("Push forcé…") : t("Push…")}
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
