import { Activity, ClipboardList, FileDiff } from "lucide-react";

import { Async, Empty, Row, Rows, useAsync } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { api, formatDate } from "@/lib/api";
import type { ActivityEntry, FileDiff as Diff, SessionSummary } from "@/lib/types";
import { cn } from "cn";

export function FilesPanel({ session }: { session: SessionSummary }) {
  const state = useAsync(
    () => api<{ diffs: Diff[] }>("/api/session/files", { id: session.sessionId }),
    [session.sessionId],
  );

  return (
    <Async state={state}>
      {({ diffs }) =>
        diffs.length === 0 ? (
          <Empty icon={FileDiff}>Aucun fichier touché.</Empty>
        ) : (
          <Rows>
            {diffs.map((diff) => (
              <Row
                key={diff.trackingPath}
                title={<span className="font-mono text-[11px]">{diff.trackingPath}</span>}
                sub={
                  <>
                    <span className="text-emerald-600 dark:text-emerald-400">+{diff.linesAdded}</span>{" "}
                    <span className="text-destructive">−{diff.linesRemoved}</span>
                  </>
                }
                badges={
                  <>
                    {diff.created && <Badge variant="secondary">créé</Badge>}
                    {diff.deleted && <Badge variant="outline">supprimé</Badge>}
                    {diff.binary && <Badge variant="outline">binaire</Badge>}
                    {diff.beforeMissing && <Badge variant="outline">sauvegarde absente</Badge>}
                  </>
                }
              >
                {diff.unified && (
                  <pre className="mt-1 max-h-72 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed">
                    {diff.unified.split("\n").map((line, index) => (
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
                )}
              </Row>
            ))}
          </Rows>
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

export function ActivityPanel({ session }: { session: SessionSummary }) {
  const state = useAsync(
    () => api<{ entries: ActivityEntry[]; total: number }>("/api/session/activity", {
      id: session.sessionId,
      limit: 300,
    }),
    [session.sessionId],
  );

  return (
    <Async state={state}>
      {(feed) =>
        feed.entries.length === 0 ? (
          <Empty icon={Activity}>Aucune activité.</Empty>
        ) : (
          <>
            {feed.total > feed.entries.length && (
              <p className="py-1 text-[11px] text-muted-foreground">
                {feed.entries.length} dernières entrées sur {feed.total}.
              </p>
            )}
            <ul className="m-0 list-none p-0 text-[12px]">
              {feed.entries.map((entry, index) => (
                <li
                  key={index}
                  title={formatDate(entry.at)}
                  className="flex gap-2 border-b py-1.5 last:border-0"
                >
                  <span className="w-14 shrink-0 text-[10px] tracking-wide text-muted-foreground uppercase">
                    {entry.kind === "tool" ? entry.name : ACTIVITY_LABEL[entry.kind]}
                  </span>
                  <span
                    className={cn(
                      "min-w-0 flex-1 break-words",
                      entry.kind === "tool" && "font-mono text-[11px] text-muted-foreground",
                      entry.kind === "tool" && entry.failed && "text-destructive",
                    )}
                  >
                    {entry.kind === "tool" ? entry.summary : entry.text}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )
      }
    </Async>
  );
}

export function PlanPanel({ session }: { session: SessionSummary }) {
  const state = useAsync(
    () =>
      api<{ plan?: { text: string; progress?: { done: number; total: number } }; mode?: string; planModeEntries: number }>(
        "/api/session/plan",
        { id: session.sessionId },
      ),
    [session.sessionId],
  );

  return (
    <Async state={state}>
      {({ plan, mode, planModeEntries }) =>
        !plan ? (
          <Empty icon={ClipboardList}>
            {planModeEntries > 0
              ? "Passée en mode plan, mais aucun plan soumis."
              : `Jamais passée en mode plan. Mode courant : ${mode ?? "inconnu"}.`}
          </Empty>
        ) : (
          <>
            {plan.progress && (
              <p className="py-1 text-[11px] text-muted-foreground">
                {plan.progress.done} sur {plan.progress.total} étapes cochées
              </p>
            )}
            <pre className="overflow-auto rounded-md border bg-muted/40 p-3 text-[12px] leading-relaxed whitespace-pre-wrap">
              {plan.text}
            </pre>
          </>
        )
      }
    </Async>
  );
}
