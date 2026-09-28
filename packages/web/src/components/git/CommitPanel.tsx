import { ChevronDown, ChevronRight, FolderTree, GitCommitHorizontal, RefreshCw, Sparkles, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { FileIcon } from "@/components/FileIcon";
import { PushDialog } from "@/components/GitChip";
import { ContextArea } from "@/components/Menu";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { resolvedLanguage, t } from "@/i18n";
import { api, post } from "@/lib/api";
import { changeTree, filesUnder, type ChangeDir } from "@/lib/change-tree";
import { cn } from "cn";
import { openDiff, openFile } from "@/state/editor";
import { getState, selectedSessionOf } from "@/state/store";

type ChangeKind = "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflict";

interface Change {
  path: string;
  from?: string;
  kind: ChangeKind;
  staged: boolean;
}

const GROUPS: { id: string; label: string; kinds: ChangeKind[] }[] = [
  { id: "conflicts", label: "Conflits", kinds: ["conflict"] },
  { id: "changes", label: "Modifications", kinds: ["modified", "added", "deleted", "renamed"] },
  { id: "untracked", label: "Non versionnés", kinds: ["untracked"] },
];

/** Lettre et couleur d'un changement, comme dans la vue Git des IDE. */
const MARK: Record<ChangeKind, { letter: string; className: string }> = {
  modified: { letter: "M", className: "text-sky-600 dark:text-sky-400" },
  added: { letter: "A", className: "text-emerald-600 dark:text-emerald-400" },
  deleted: { letter: "D", className: "text-destructive" },
  renamed: { letter: "R", className: "text-violet-600 dark:text-violet-400" },
  untracked: { letter: "U", className: "text-muted-foreground" },
  conflict: { letter: "!", className: "text-amber-600 dark:text-amber-400" },
};

/** Case à trois états : cochée, décochée, ou en partie pour un groupe. */
function TriCheck({ state, onChange }: { state: boolean | "mixed"; onChange: (value: boolean) => void }) {
  return (
    <input
      type="checkbox"
      className="size-3.5 shrink-0 accent-[var(--primary)]"
      checked={state === true}
      ref={(element) => {
        if (element) element.indeterminate = state === "mixed";
      }}
      onChange={(event) => onChange(event.target.checked)}
      onClick={(event) => event.stopPropagation()}
    />
  );
}

/** Rangement par dossier, gardé dans ce navigateur : une commodité de la vue, rien de plus. */
const BY_DIRECTORY_KEY = "clide.commit.by-directory";

function readByDirectory(): boolean {
  try {
    return localStorage.getItem(BY_DIRECTORY_KEY) === "1";
  } catch {
    return false;
  }
}

function writeByDirectory(value: boolean): void {
  try {
    localStorage.setItem(BY_DIRECTORY_KEY, value ? "1" : "0");
  } catch {
    // Mémoire du navigateur indisponible : le choix vaut pour la page.
  }
}

/** Session dont on peut tirer un message : celle de l'onglet Claude regardé, sinon celle choisie dans History. */
function currentSessionId(): string | undefined {
  const state = getState();
  const live = state.activeTerminalId ? state.live[state.activeTerminalId]?.sessionId : undefined;
  return live ?? selectedSessionOf(state)?.sessionId;
}

/**
 * Ce qui attend d'être commité, à cocher fichier par fichier, et le commit.
 *
 * Seuls les fichiers cochés partent, dans l'état où ils sont sur disque ; ce qui
 * était déjà indexé à part n'est pas touché. Le push reste un geste à part, avec
 * l'aperçu de ce qui partirait.
 */
export function CommitPanel({ root }: { root: string }) {
  const [changes, setChanges] = useState<Change[]>();
  const [error, setError] = useState<string>();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [byDirectory, setByDirectory] = useState(readByDirectory);
  const [folded, setFolded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const { changes: list } = await api<{ changes: Change[] }>("/api/git/changes", { root });
      setChanges(list);
      setError(undefined);
      // Un fichier qui apparaît est coché d'office, comme dans les IDE ; un fichier décoché le reste.
      setChecked((current) => {
        const known = new Set(changes?.map((change) => change.path) ?? []);
        const next = new Set([...current].filter((path) => list.some((change) => change.path === path)));
        for (const change of list) if (!known.has(change.path) && change.kind !== "untracked") next.add(change.path);
        return next;
      });
    } catch (caught) {
      setChanges([]);
      setError((caught as Error).message);
    }
    // `changes` sert à reconnaître les nouveaux fichiers, pas à relancer la lecture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);

  useEffect(() => {
    setChanges(undefined);
    setChecked(new Set());
    void load();
    const timer = setInterval(load, 10_000);
    window.addEventListener("focus", load);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, [load]);

  useEffect(() => {
    if (!amend) return;
    void api<{ message: string }>("/api/git/last-message", { root }).then((result) =>
      setMessage((current) => current || result.message),
    );
  }, [amend, root]);

  const selected = useMemo(() => (changes ?? []).filter((change) => checked.has(change.path)), [changes, checked]);

  const setMany = (paths: string[], on: boolean) =>
    setChecked((current) => {
      const next = new Set(current);
      for (const path of paths) {
        if (on) next.add(path);
        else next.delete(path);
      }
      return next;
    });

  const commit = async (thenPush: boolean) => {
    setBusy(true);
    setError(undefined);
    try {
      await post("/api/git/commit", {
        root,
        message,
        amend,
        // Un renommage se commite par ses deux noms, sinon l'ancien resterait supprimé à part.
        paths: selected.flatMap((change) => (change.from ? [change.path, change.from] : [change.path])),
        untracked: selected.filter((change) => change.kind === "untracked").map((change) => change.path),
      });
      setMessage("");
      setAmend(false);
      await load();
      if (thenPush) setPushing(true);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const draft = async () => {
    const id = currentSessionId();
    if (!id) {
      setError(t("Aucune session à résumer : lance Claude dans un onglet, ou choisis une session dans History."));
      return;
    }
    setDrafting(true);
    try {
      const { writeup } = await post<{ writeup: { text: string } | null }>("/api/session/writeup/draft", {
        id,
        kind: "commit",
        language: resolvedLanguage(),
      });
      if (writeup?.text) setMessage(writeup.text);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setDrafting(false);
    }
  };

  const diff = (change: Change) =>
    change.kind === "untracked" ? void openFile(`${root}\\${change.path.replace(/\//g, "\\")}`) : void openDiff(root, { path: change.path, ...(change.from ? { from: change.from } : {}) });

  if (changes === undefined) return <p className="py-2 text-[12px] text-muted-foreground">{t("Lecture de l'état git…")}</p>;

  const fileRow = (change: Change, depth: number) => (
    <ContextArea
      key={change.path}
      items={[
        { kind: "item", label: t("Voir le diff"), run: () => diff(change) },
        {
          kind: "item",
          label: t("Ouvrir le fichier"),
          disabled: change.kind === "deleted",
          run: () => void openFile(`${root}\\${change.path.replace(/\//g, "\\")}`),
        },
      ]}
    >
      <li
        title={change.from ? `${change.from} → ${change.path}` : change.path}
        onDoubleClick={() => diff(change)}
        className="flex cursor-default items-center gap-2 rounded px-1 py-0.5 text-[12px] hover:bg-accent"
        style={depth > 0 ? { paddingLeft: `${depth * 14 + 4}px` } : undefined}
        data-change={change.path}
      >
        <TriCheck state={checked.has(change.path)} onChange={(value) => setMany([change.path], value)} />
        <FileIcon name={change.path.split("/").pop() ?? change.path} directory={false} className="size-3.5" />
        <span className={cn("min-w-0 truncate", change.kind === "deleted" && "line-through opacity-70", byDirectory && "flex-1")}>
          {change.path.split("/").pop()}
        </span>
        {/* Rangé par dossier, le chemin est dans l'arbre : on ne le répète pas. */}
        {!byDirectory && (
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
            {change.path.includes("/") ? change.path.slice(0, change.path.lastIndexOf("/")) : ""}
          </span>
        )}
        <span className={cn("w-3 shrink-0 text-center font-mono text-[11px]", MARK[change.kind].className)}>
          {MARK[change.kind].letter}
        </span>
      </li>
    </ContextArea>
  );

  /** Un dossier et son contenu, repliable, coché d'un coup. */
  const dirRows = (dir: ChangeDir<Change>, group: string, depth: number): ReactNode[] => {
    const key = `${group}|${dir.path}`;
    const isFolded = folded.has(key);
    const paths = filesUnder(dir).map((change) => change.path);
    const on = paths.filter((path) => checked.has(path)).length;
    return [
      <li
        key={`dir:${key}`}
        className="flex cursor-default items-center gap-1.5 rounded px-1 py-0.5 text-[12px] hover:bg-accent"
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
        data-change-dir={dir.path}
      >
        <button
          type="button"
          className="grid size-4 shrink-0 place-items-center"
          title={isFolded ? t("Déplier") : t("Replier")}
          onClick={() =>
            setFolded((current) => {
              const next = new Set(current);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            })
          }
        >
          {isFolded ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
        </button>
        <TriCheck state={on === 0 ? false : on === paths.length ? true : "mixed"} onChange={(value) => setMany(paths, value)} />
        <FileIcon name={dir.name} directory open={!isFolded} className="size-3.5" />
        <span className="min-w-0 flex-1 truncate">{dir.name}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{paths.length}</span>
      </li>,
      ...(isFolded ? [] : [...dir.dirs.flatMap((child) => dirRows(child, group, depth + 1)), ...dir.files.map((change) => fileRow(change, depth + 1))]),
    ];
  };

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="flex-1">
          {changes.length === 0
            ? t("Rien à commiter.")
            : t("{selected} fichier(s) choisi(s) sur {total}", { selected: selected.length, total: changes.length })}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className={cn("size-6", byDirectory && "bg-accent text-primary")}
          aria-pressed={byDirectory}
          title={t("Ranger par dossier")}
          onClick={() => {
            writeByDirectory(!byDirectory);
            setByDirectory(!byDirectory);
          }}
          data-by-directory
        >
          <FolderTree className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="size-6" title={t("Recharger")} onClick={() => void load()}>
          <RefreshCw className="size-3.5" />
        </Button>
      </div>

      {GROUPS.map((group) => {
        const items = changes.filter((change) => group.kinds.includes(change.kind));
        if (items.length === 0) return null;
        const on = items.filter((change) => checked.has(change.path)).length;
        return (
          <div key={group.id}>
            <label className="flex cursor-pointer items-center gap-2 py-0.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              <TriCheck
                state={on === 0 ? false : on === items.length ? true : "mixed"}
                onChange={(value) => setMany(items.map((change) => change.path), value)}
              />
              {t(group.label)} <span className="font-normal normal-case">({items.length})</span>
            </label>
            <ul className="m-0 list-none p-0">
              {byDirectory
                ? (() => {
                    const tree = changeTree(items);
                    return [...tree.dirs.flatMap((dir) => dirRows(dir, group.id, 0)), ...tree.files.map((change) => fileRow(change, 0))];
                  })()
                : items.map((change) => fileRow(change, 0))}
            </ul>
          </div>
        );
      })}

      <div className="grid gap-2">
        <Textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={t("Message du commit")}
          spellCheck={false}
          className="min-h-20 text-[12px]"
          onKeyDown={(event) => {
            // Ctrl+Entrée commite, comme dans les IDE ; Entrée seule passe à la ligne.
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void commit(false);
            }
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 text-[12px]">
            <input type="checkbox" className="accent-[var(--primary)]" checked={amend} onChange={(event) => setAmend(event.target.checked)} />
            {t("Amender le dernier commit")}
          </label>
          <Button variant="ghost" size="sm" className="h-7 text-[11px]" disabled={drafting} onClick={() => void draft()}>
            <Sparkles className={cn("size-3.5", drafting && "animate-pulse")} />
            {drafting ? t("Rédaction…") : t("Rédiger depuis la session")}
          </Button>
          <div className="flex-1" />
          <Button
            size="sm"
            className="h-7"
            disabled={busy || !message.trim() || (selected.length === 0 && !amend)}
            onClick={() => void commit(false)}
          >
            <GitCommitHorizontal className="size-3.5" />
            {t("Commit ({count})", { count: selected.length })}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            disabled={busy || !message.trim() || (selected.length === 0 && !amend)}
            onClick={() => void commit(true)}
          >
            <Upload className="size-3.5" />
            {t("Commit + push")}
          </Button>
        </div>
        {error && <p className="text-[12px] text-destructive">{error}</p>}
      </div>

      {pushing && <PushDialog root={root} onClose={() => setPushing(false)} onDone={() => setPushing(false)} />}
    </div>
  );
}
