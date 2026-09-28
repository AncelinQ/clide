import {
  Activity,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  ClipboardList,
  CornerDownRight,
  FileDiff,
  Undo2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Async, Empty, Row, Rows, useAsync } from "@/components/common";
import { Markdown } from "@/components/Markdown";
import { ActivityDetailDialog } from "@/components/panels/activity-detail";
import { Thumbnails } from "@/components/panels/captures";
import { DiffLines, FileRestoreDialog } from "@/components/panels/file-restore";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { decimal, t } from "@/i18n";
import { api, formatDate, post } from "@/lib/api";
import type { ActivityEntry, FileDiff as Diff, PlanFileInfo, SessionCost, TokenUsage } from "@/lib/types";
import { describeSessionCost, formatSessionCost } from "@/components/panels/costs";
import { cn } from "cn";
import { useNewestFirst } from "@/components/ModeBlock";
import { setState, useStore } from "@/state/store";

/**
 * Session montrée par le bloc. `refresh` change à chaque ajout au transcript
 * quand la session est vivante, pour que les panneaux se relisent.
 */
export interface ShownSession {
  sessionId: string;
  refresh?: string;
  tokens?: TokenUsage;
  price?: SessionCost;
}

/** « 12,3 k » : un volume de tokens se lit en ordre de grandeur. */
export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${decimal(count / 1000, 1)} k`;
  return `${decimal(count / 1_000_000, 2)} M`;
}

/**
 * Éléments dans l'ordre voulu, chacun avec sa position d'origine : l'activité
 * repère une entrée par son rang dans la session, pas par sa place à l'écran.
 */
export function ordered<T>(items: T[], newestFirst: boolean): { item: T; index: number }[] {
  const indexed = items.map((item, index) => ({ item, index }));
  return newestFirst ? indexed.reverse() : indexed;
}

/**
 * Fichiers du plus récemment modifié au plus ancien. Un fichier sans date part
 * en fin de liste, dans l'ordre reçu : on ne sait pas quand il a été touché.
 */
function byRecency(diffs: Diff[]): Diff[] {
  const time = (diff: Diff) => (diff.changedAt ? Date.parse(diff.changedAt) : -Infinity);
  return [...diffs].sort((a, b) => time(b) - time(a));
}

export function FilesPanel({ session }: { session: ShownSession }) {
  const state = useAsync(
    () => api<{ diffs: Diff[] }>("/api/session/files", { id: session.sessionId }),
    [session.sessionId],
    session.refresh,
  );
  const [restoring, setRestoring] = useState<string>();
  const newest = useNewestFirst("files");
  // Fichiers dont le diff est replié. Propre à la session montrée : une autre
  // session repart dépliée.
  const [folded, setFolded] = useState<Set<string>>(new Set());
  useEffect(() => setFolded(new Set()), [session.sessionId]);
  // Un clic qui n'ouvre rien se dit ici : la fenêtre attendue n'apparaît pas.
  const [notice, setNotice] = useState<string>();
  useEffect(() => setNotice(undefined), [session.sessionId]);

  const openOnDisk = (path: string, reveal: boolean) => {
    setNotice(undefined);
    post("/api/session/files/open", { id: session.sessionId, path, reveal }).catch((error: unknown) => {
      setNotice(t("Ouverture impossible : {error}", { error: (error as Error).message }));
    });
  };

  const toggle = (path: string) =>
    setFolded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <Async state={state}>
      {({ diffs }) =>
        diffs.length === 0 ? (
          <Empty icon={FileDiff}>{t("Aucun fichier touché.")}</Empty>
        ) : (
          <>
            <div className="flex items-center gap-1 pt-1">
              <span className="flex-1 text-[11px] text-muted-foreground">
                {t(diffs.length === 1 ? "{count} fichier" : "{count} fichiers", { count: diffs.length })}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px]"
                onClick={() => setFolded(new Set(diffs.filter((diff) => diff.unified).map((diff) => diff.trackingPath)))}
              >
                <ChevronsDownUp /> {t("Tout replier")}
              </Button>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => setFolded(new Set())}>
                <ChevronsUpDown /> {t("Tout déplier")}
              </Button>
            </div>
            {notice && <p className="py-1 text-[11px] text-destructive">{notice}</p>}
            <Rows>
              {restoring && (
                <FileRestoreDialog
                  sessionId={session.sessionId}
                  trackingPath={restoring}
                  onClose={() => setRestoring(undefined)}
                  onRestored={state.reload}
                />
              )}
              {(newest ? byRecency(diffs) : diffs).map((diff) => {
                const open = !folded.has(diff.trackingPath);
                const Chevron = open ? ChevronDown : ChevronRight;
                return (
                  <Row
                    key={diff.trackingPath}
                    title={
                      <span className="inline-flex items-baseline gap-1 font-mono text-[11px]">
                        {diff.unified && (
                          <button
                            type="button"
                            onClick={() => toggle(diff.trackingPath)}
                            aria-expanded={open}
                            title={open ? t("Replier le diff") : t("Déplier le diff")}
                            className="-m-1 shrink-0 self-center rounded p-1 hover:bg-accent"
                          >
                            <Chevron className="size-3" />
                          </button>
                        )}
                        {diff.deleted ? (
                          diff.trackingPath
                        ) : (
                          <button
                            type="button"
                            title={t("Ouvrir avec l'application par défaut ; Maj+clic : afficher dans l'Explorateur")}
                            className="text-left underline-offset-2 hover:text-primary hover:underline"
                            onClick={(event) => openOnDisk(diff.trackingPath, event.shiftKey)}
                          >
                            {diff.trackingPath}
                          </button>
                        )}
                      </span>
                    }
                    sub={
                      <>
                        <span className="text-emerald-600 dark:text-emerald-400">+{diff.linesAdded}</span>{" "}
                        <span className="text-destructive">−{diff.linesRemoved}</span>
                      </>
                    }
                    badges={
                      <>
                        {diff.created && <Badge variant="secondary">{t("créé")}</Badge>}
                        {diff.deleted && <Badge variant="outline">{t("supprimé")}</Badge>}
                        {diff.binary && <Badge variant="outline">{t("binaire")}</Badge>}
                        {diff.viaBash && (
                          <Badge
                            variant="outline"
                            title={t("Écrit par une commande : Claude Code en a relevé le diff, il n'y a pas de sauvegarde à restaurer.")}
                          >
                            {t("commande")}
                          </Badge>
                        )}
                        {diff.beforeMissing && !diff.viaBash && <Badge variant="outline">{t("sauvegarde absente")}</Badge>}
                      </>
                    }
                    actions={
                      !diff.beforeMissing &&
                      (diff.unified || diff.binary || diff.created || diff.deleted) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[11px]"
                          title={t("Ramener ce fichier à son état d'avant la session")}
                          onClick={() => setRestoring(diff.trackingPath)}
                        >
                          <Undo2 />
                          {t("restaurer")}
                        </Button>
                      )
                    }
                  >
                    {diff.unified && open && <DiffLines unified={diff.unified} className="mt-1 max-h-72" />}
                  </Row>
                );
              })}
            </Rows>
          </>
        )
      }
    </Async>
  );
}

const ACTIVITY_LABEL: Record<string, string> = {
  prompt: "moi",
  command: "commande",
  answer: "claude",
  tool: "outil",
  note: "note",
};

/** Volume et coût de la session, en tête de son activité. */
function Consumption({ session }: { session: ShownSession }) {
  const { tokens, price } = session;
  const showCosts = useStore((state) => state.showCosts);
  const cost = showCosts ? formatSessionCost(price) : undefined;
  if (!tokens && !cost) return null;
  const parts = [
    tokens && t("contexte {tokens}", { tokens: formatTokens(tokens.context) }),
    tokens && t("{tokens} en sortie", { tokens: formatTokens(tokens.output) }),
    tokens && t("{tokens} en entrée", { tokens: formatTokens(tokens.input + tokens.cacheCreation) }),
    tokens && tokens.cacheRead > 0 && t("{tokens} lus en cache", { tokens: formatTokens(tokens.cacheRead) }),
    cost,
  ].filter(Boolean);
  return (
    <p className="py-1 text-[11px] text-muted-foreground" title={[tokens?.model, showCosts && describeSessionCost(price)].filter(Boolean).join(" · ")}>
      {parts.join("  ·  ")}
    </p>
  );
}

/** Chemin des sous-agents ouverts, de la session vers le plus profond. */
function AgentTrail({ sessionId, path }: { sessionId: string; path: { agentId: string; label: string }[] }) {
  const goTo = (depth: number) =>
    setState({ activityAgents: depth === 0 ? null : { sessionId, path: path.slice(0, depth) } });
  return (
    <nav className="flex flex-wrap items-center gap-1 py-1 text-[11px] text-muted-foreground">
      <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => goTo(0)}>
        {t("session")}
      </button>
      {path.map((step, depth) => (
        <span key={step.agentId} className="flex min-w-0 items-center gap-1">
          <ChevronRight className="size-3 shrink-0" />
          {depth === path.length - 1 ? (
            <span className="truncate text-foreground" title={step.label}>
              {step.label}
            </span>
          ) : (
            <button
              type="button"
              className="truncate text-primary underline-offset-2 hover:underline"
              title={step.label}
              onClick={() => goTo(depth + 1)}
            >
              {step.label}
            </button>
          )}
        </span>
      ))}
      <button
        type="button"
        className="ml-auto text-primary underline-offset-2 hover:underline"
        onClick={() => goTo(path.length - 1)}
      >
        {t("remonter")}
      </button>
    </nav>
  );
}

export function ActivityPanel({ session }: { session: ShownSession }) {
  // Les sous-agents ouverts ne valent que pour leur session : en changer revient en haut.
  const path = useStore((state) =>
    state.activityAgents?.sessionId === session.sessionId ? state.activityAgents.path : undefined,
  );
  const agent = path?.at(-1)?.agentId;
  const focus = useStore((state) =>
    state.activityFocus?.sessionId === session.sessionId && state.activityFocus.agentId === agent
      ? state.activityFocus.index
      : undefined,
  );
  const state = useAsync(
    () =>
      api<{ entries: ActivityEntry[]; total: number; offset: number }>("/api/session/activity", {
        id: session.sessionId,
        ...(agent ? { agent } : {}),
        ...(focus !== undefined ? { around: focus } : { limit: 300 }),
      }),
    [session.sessionId, agent, focus],
    // Une entrée ouverte depuis la recherche reste en place : la session qui
    // s'écrit ne la fait pas glisser.
    focus === undefined ? session.refresh : undefined,
  );
  const newest = useNewestFirst("activity");
  // Entrée ouverte en entier, par son rang dans la liste reçue.
  const [detail, setDetail] = useState<number>();
  const focused = useRef<HTMLLIElement>(null);
  useEffect(() => {
    focused.current?.scrollIntoView({ block: "center" });
  }, [state.data, focus]);

  return (
    <Async state={state}>
      {(feed) =>
        feed.entries.length === 0 ? (
          <Empty icon={Activity}>{t("Aucune activité.")}</Empty>
        ) : (
          <>
            {path ? <AgentTrail sessionId={session.sessionId} path={path} /> : <Consumption session={session} />}
            {focus !== undefined ? (
              <p className="flex items-center gap-2 py-1 text-[11px] text-muted-foreground">
                {t("Entrées {from} à {to} sur {total}, autour du résultat.", {
                  from: feed.offset + 1,
                  to: feed.offset + feed.entries.length,
                  total: feed.total,
                })}
                <button
                  type="button"
                  className="text-primary underline-offset-2 hover:underline"
                  onClick={() => setState({ activityFocus: null })}
                >
                  {t("revenir aux dernières")}
                </button>
              </p>
            ) : (
              feed.total > feed.entries.length && (
                <p className="py-1 text-[11px] text-muted-foreground">
                  {t("{count} dernières entrées sur {total}.", { count: feed.entries.length, total: feed.total })}
                </p>
              )
            )}
            {detail !== undefined && feed.entries[detail] && (
              <ActivityDetailDialog
                sessionId={session.sessionId}
                {...(agent ? { agentId: agent } : {})}
                entries={feed.entries}
                index={detail}
                offset={feed.offset}
                onClose={() => setDetail(undefined)}
              />
            )}
            <ul className="m-0 list-none p-0 text-[12px]">
              {ordered(feed.entries, newest).map(({ item: entry, index }) => (
                <li
                  key={feed.offset + index}
                  ref={feed.offset + index === focus ? focused : undefined}
                  title={`${formatDate(entry.at)} — ${t("double-clic : voir en entier")}`}
                  onDoubleClick={() => setDetail(index)}
                  className={cn(
                    "flex gap-2 border-b py-1.5 last:border-0",
                    feed.offset + index === focus && "-mx-3 bg-primary/15 px-3",
                  )}
                >
                  <span className="w-16 shrink-0 truncate text-[10px] tracking-wide text-muted-foreground uppercase">
                    {entry.kind === "tool" ? entry.name : t(ACTIVITY_LABEL[entry.kind] ?? "")}
                  </span>
                  <span
                    className={cn(
                      "min-w-0 flex-1 break-words",
                      entry.kind === "tool" && "font-mono text-[11px] text-muted-foreground",
                      entry.kind === "tool" && entry.failed && "text-destructive",
                    )}
                  >
                    {entry.kind === "tool" ? entry.summary : entry.text}
                    {(entry.kind === "tool" || entry.kind === "prompt") && entry.images ? (
                      <Thumbnails
                        sessionId={session.sessionId}
                        index={feed.offset + index}
                        count={entry.images}
                        {...(agent ? { agentId: agent } : {})}
                      />
                    ) : null}
                  </span>
                  {entry.kind === "tool" && entry.agentId && (
                    <button
                      type="button"
                      className="flex shrink-0 items-start gap-0.5 text-[11px] text-primary underline-offset-2 hover:underline"
                      title={t("Voir l'activité de ce sous-agent")}
                      onClick={() =>
                        setState({
                          activityAgents: {
                            sessionId: session.sessionId,
                            path: [...(path ?? []), { agentId: entry.agentId!, label: entry.summary }],
                          },
                        })
                      }
                    >
                      <CornerDownRight className="mt-0.5 size-3" />
                      {t("ouvrir")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )
      }
    </Async>
  );
}

const OWN_PLAN = "__own__";

export function PlanPanel({ session }: { session: ShownSession }) {
  // Un autre plan de ~/.claude/plans, montré à la place de celui de la session,
  // le temps de la session montrée : celui d'une autre session, ou rédigé à part.
  const [linked, setLinked] = useState<string>();
  useEffect(() => setLinked(undefined), [session.sessionId]);
  const state = useAsync(
    () =>
      api<{ plan?: { text: string; progress?: { done: number; total: number } }; mode?: string; planModeEntries: number }>(
        "/api/session/plan",
        { id: session.sessionId, ...(linked ? { path: linked } : {}) },
      ),
    [session.sessionId, linked],
    session.refresh,
  );
  const plans = useAsync(() => api<{ plans: PlanFileInfo[] }>("/api/plans"), [session.sessionId]);
  const choices = plans.data?.plans ?? [];

  return (
    <>
      {(choices.length > 0 || linked) && (
        <div className="flex items-center gap-2 py-1">
          <Select value={linked ?? OWN_PLAN} onValueChange={(value) => setLinked(value === OWN_PLAN ? undefined : value)}>
            <SelectTrigger className="h-7 w-full text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={OWN_PLAN}>{t("Plan de la session")}</SelectItem>
              {choices.map((plan) => (
                <SelectItem key={plan.path} value={plan.path}>
                  {plan.title ?? plan.name} · {formatDate(plan.modifiedAt)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {linked && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => setLinked(undefined)}>
              {t("détacher")}
            </Button>
          )}
        </div>
      )}
      <Async state={state}>
        {({ plan, mode, planModeEntries }) =>
          !plan ? (
            <Empty icon={ClipboardList}>
              {planModeEntries > 0
                ? t("Passée en mode plan, mais aucun plan soumis.")
                : t("Jamais passée en mode plan. Mode courant : {mode}.", { mode: mode ?? t("inconnu") })}
            </Empty>
          ) : (
            <>
              {plan.progress && (
                <p className="py-1 text-[11px] text-muted-foreground">
                  {t("{done} sur {total} étapes cochées", { done: plan.progress.done, total: plan.progress.total })}
                </p>
              )}
              <Markdown text={plan.text} className="rounded-md border bg-muted/20 px-3 py-2" />
            </>
          )
        }
      </Async>
    </>
  );
}
