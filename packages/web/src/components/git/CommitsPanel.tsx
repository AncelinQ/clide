import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { FileIcon } from "@/components/FileIcon";
import { ContextArea } from "@/components/Menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { api, formatDate } from "@/lib/api";
import { cn } from "cn";
import { openDiff } from "@/state/editor";

interface Commit {
  hash: string;
  parents: string[];
  author: string;
  date: string;
  refs: string[];
  subject: string;
}

interface GraphRow {
  hash: string;
  column: number;
  before: (string | null)[];
  after: (string | null)[];
}

interface CommitFile {
  path: string;
  from?: string;
  kind: "modified" | "added" | "deleted" | "renamed";
}

const ROW = 24;
const LANE = 12;
/** Couleurs des voies, reprises tour à tour : la même branche garde la sienne d'une ligne à l'autre. */
const COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#ec4899", "#14b8a6", "#ef4444", "#64748b"];
const color = (lane: number) => COLORS[lane % COLORS.length] as string;
const x = (lane: number) => LANE / 2 + lane * LANE;

/**
 * Une ligne du graphe : les voies qui la traversent, le point du commit, et ses
 * liens vers les voies de ses parents. Une voie qui change de colonne entre le
 * haut et le bas de la ligne se dessine en diagonale.
 */
function GraphCell({ row, commit }: { row: GraphRow; commit: Commit }) {
  const width = Math.max(row.before.length, row.after.length, row.column + 1) * LANE;
  const middle = ROW / 2;
  const lines: { x1: number; y1: number; x2: number; y2: number; stroke: string }[] = [];
  row.before.forEach((hash, lane) => {
    if (!hash || hash === row.hash) return;
    const target = row.after.indexOf(hash);
    if (target === -1) return;
    lines.push({ x1: x(lane), y1: 0, x2: x(target), y2: ROW, stroke: color(target) });
  });
  // Les voies qui attendaient ce commit le rejoignent ; aucune pour une tête de branche.
  row.before.forEach((hash, lane) => {
    if (hash === row.hash) lines.push({ x1: x(lane), y1: 0, x2: x(row.column), y2: middle, stroke: color(lane) });
  });
  for (const parent of commit.parents) {
    const target = row.after.indexOf(parent);
    if (target !== -1) lines.push({ x1: x(row.column), y1: middle, x2: x(target), y2: ROW, stroke: color(target) });
  }
  return (
    <svg width={width} height={ROW} className="shrink-0" aria-hidden>
      {lines.map((line, index) => (
        <line key={index} {...line} strokeWidth={1.6} strokeLinecap="round" />
      ))}
      <circle cx={x(row.column)} cy={middle} r={3.5} fill={color(row.column)} stroke="var(--card)" strokeWidth={1.5} />
    </svg>
  );
}

function CommitDetail({ root, commit }: { root: string; commit: Commit }) {
  const [detail, setDetail] = useState<{ message: string; files: CommitFile[] }>();
  useEffect(() => {
    setDetail(undefined);
    void api<{ message: string; files: CommitFile[] }>("/api/git/show", { root, hash: commit.hash }).then(setDetail);
  }, [root, commit.hash]);
  return (
    <div className="grid gap-2 border-t pt-2 text-[12px]">
      <div className="flex flex-wrap items-baseline gap-x-3 text-[11px] text-muted-foreground">
        <span className="font-mono">{commit.hash.slice(0, 10)}</span>
        <span>{commit.author}</span>
        <span>{formatDate(commit.date)}</span>
        {commit.parents.length > 1 && <span>{t("fusion de {count} parents", { count: commit.parents.length })}</span>}
      </div>
      <pre className="m-0 font-sans whitespace-pre-wrap">{detail?.message ?? commit.subject}</pre>
      <ul className="m-0 list-none p-0">
        {detail?.files.map((file) => (
          <ContextArea
            key={file.path}
            items={[
              {
                kind: "item",
                label: t("Voir le diff"),
                run: () => void openDiff(root, { path: file.path, ref: commit.hash, ...(file.from ? { from: file.from } : {}) }),
              },
            ]}
          >
            <li
              title={file.from ? `${file.from} → ${file.path}` : file.path}
              onDoubleClick={() => void openDiff(root, { path: file.path, ref: commit.hash, ...(file.from ? { from: file.from } : {}) })}
              className="flex cursor-default items-center gap-2 rounded px-1 py-0.5 hover:bg-accent"
            >
              <FileIcon name={file.path.split("/").pop() ?? file.path} directory={false} className="size-3.5" />
              <span className={cn("min-w-0 truncate", file.kind === "deleted" && "line-through opacity-70")}>{file.path}</span>
            </li>
          </ContextArea>
        ))}
      </ul>
    </div>
  );
}

/** Le journal de toutes les branches, avec son graphe, et le détail du commit choisi. */
export function CommitsPanel({ root }: { root: string }) {
  const [log, setLog] = useState<{ commits: Commit[]; rows: GraphRow[] }>();
  const [error, setError] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [filter, setFilter] = useState("");

  const load = useCallback(() => {
    api<{ commits: Commit[]; rows: GraphRow[] }>("/api/git/log", { root })
      .then((result) => {
        setLog(result);
        setError(undefined);
      })
      .catch((caught: unknown) => setError((caught as Error).message));
  }, [root]);

  useEffect(() => {
    setLog(undefined);
    setSelected(undefined);
    load();
  }, [load]);

  if (error) return <p className="py-2 text-[12px] text-muted-foreground">{error}</p>;
  if (!log) return <p className="py-2 text-[12px] text-muted-foreground">{t("Lecture du journal…")}</p>;

  const needle = filter.trim().toLowerCase();
  const shown = log.commits
    .map((commit, index) => ({ commit, row: log.rows[index] as GraphRow }))
    .filter(({ commit }) =>
      needle ? `${commit.subject} ${commit.author} ${commit.hash} ${commit.refs.join(" ")}`.toLowerCase().includes(needle) : true,
    );
  const current = log.commits.find((commit) => commit.hash === selected);

  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t("Filtrer les commits…")}
          spellCheck={false}
          className="h-7 min-w-0 flex-1 rounded-md border bg-transparent px-2 text-[12px] outline-none"
        />
        <Button variant="ghost" size="icon" className="size-6" title={t("Recharger")} onClick={load}>
          <RefreshCw className="size-3.5" />
        </Button>
      </div>
      <ul className="m-0 list-none p-0">
        {shown.map(({ commit, row }) => (
          <li key={commit.hash} className="contents">
          <div
            onClick={() => setSelected(commit.hash === selected ? undefined : commit.hash)}
            className={cn("flex cursor-default items-center gap-2 rounded pr-1 text-[12px] hover:bg-accent", commit.hash === selected && "bg-accent")}
            style={{ height: ROW }}
          >
            {/* Le graphe n'a de sens que sur le journal entier : filtré, il laisserait des voies sans suite. */}
            {needle ? <span className="w-2" /> : <GraphCell row={row} commit={commit} />}
            <span className="min-w-0 flex-1 truncate">{commit.subject}</span>
            {commit.refs.slice(0, 3).map((ref) => (
              <Badge key={ref} variant="secondary" className="max-w-32 shrink-0 truncate px-1 py-0 text-[10px] font-normal">
                {ref}
              </Badge>
            ))}
            <span className="w-20 shrink-0 truncate text-right text-[11px] text-muted-foreground">{commit.author}</span>
            <span className="w-16 shrink-0 text-right text-[11px] text-muted-foreground">{formatDate(commit.date).slice(0, 10)}</span>
          </div>
          {commit.hash === current?.hash && (
            <div className="pb-2 pl-6">
              <CommitDetail root={root} commit={current} />
            </div>
          )}
          </li>
        ))}
      </ul>
    </div>
  );
}
