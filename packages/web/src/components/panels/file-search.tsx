import { CaseSensitive, ChevronDown, ChevronRight, Regex, Search, SlidersHorizontal, WholeWord } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Empty } from "@/components/common";
import { FileIcon } from "@/components/FileIcon";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { cn } from "cn";
import { openFile } from "@/state/editor";

interface Match {
  line: number;
  column: number;
  length: number;
  preview: string;
  previewStart: number;
}

interface Answer {
  files: { path: string; matches: Match[] }[];
  truncated: boolean;
  error?: string;
}

/** Délai après une frappe avant de chercher : chaque touche ne relit pas tout le projet. */
const TYPING_DELAY = 300;

/** Demande de focus sur le champ de recherche, avec un texte à y mettre. */
const focusRequests = new EventTarget();

/** Met le focus sur la recherche du projet, pré-remplie avec `text` s'il y en a un. */
export function focusFileSearch(text?: string): void {
  focusRequests.dispatchEvent(new CustomEvent("focus", { detail: text }));
}

function Toggle({ on, title, onClick, children }: { on: boolean; title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground",
        on && "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary",
      )}
    >
      {children}
    </button>
  );
}

function absolute(root: string, path: string): string {
  return `${root.replace(/[\\/]+$/, "")}\\${path.split("/").join("\\")}`;
}

/**
 * Recherche d'un texte ou d'une expression dans les fichiers du projet, comme
 * la recherche de VS Code : casse, mot entier, expression, et des motifs de
 * chemins à garder ou écarter. Les résultats sont groupés par fichier ; un clic
 * ouvre le fichier à la ligne.
 */
export function FileSearchPanel({ root }: { root: string }) {
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [filters, setFilters] = useState(false);
  const [include, setInclude] = useState("");
  const [exclude, setExclude] = useState("");
  const [answer, setAnswer] = useState<Answer>();
  const [searching, setSearching] = useState(false);
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const listener = (event: Event) => {
      const text = (event as CustomEvent<string | undefined>).detail;
      if (text) setQuery(text);
      input.current?.focus();
      input.current?.select();
    };
    focusRequests.addEventListener("focus", listener);
    return () => focusRequests.removeEventListener("focus", listener);
  }, []);

  useEffect(() => {
    if (!query) {
      setAnswer(undefined);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      setSearching(true);
      const flag = (value: boolean) => (value ? "1" : "0");
      api<Answer>("/api/files/search", { root, q: query, case: flag(caseSensitive), word: flag(wholeWord), regex: flag(regex), include, exclude })
        .then((result) => alive && setAnswer(result))
        .catch((caught: unknown) => alive && setAnswer({ files: [], truncated: false, error: (caught as Error).message }))
        .finally(() => alive && setSearching(false));
    }, TYPING_DELAY);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [root, query, caseSensitive, wholeWord, regex, include, exclude]);

  const count = answer?.files.reduce((total, file) => total + file.matches.length, 0) ?? 0;

  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-0.5 rounded-md border bg-background pr-1 focus-within:ring-1 focus-within:ring-ring">
        <Input
          ref={input}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("Rechercher dans les fichiers")}
          spellCheck={false}
          className="h-7 flex-1 border-0 text-[12px] shadow-none focus-visible:ring-0"
          data-file-search
        />
        <Toggle on={caseSensitive} title={t("Respecter la casse")} onClick={() => setCaseSensitive((value) => !value)}>
          <CaseSensitive className="size-4" />
        </Toggle>
        <Toggle on={wholeWord} title={t("Mot entier")} onClick={() => setWholeWord((value) => !value)}>
          <WholeWord className="size-4" />
        </Toggle>
        <Toggle on={regex} title={t("Expression régulière")} onClick={() => setRegex((value) => !value)}>
          <Regex className="size-4" />
        </Toggle>
        <Toggle on={filters || !!include || !!exclude} title={t("Fichiers à inclure ou exclure")} onClick={() => setFilters((value) => !value)}>
          <SlidersHorizontal className="size-3.5" />
        </Toggle>
      </div>
      {filters && (
        <div className="grid gap-1">
          <Input
            value={include}
            onChange={(event) => setInclude(event.target.value)}
            placeholder={t("Fichiers à inclure (src/**, *.ts)")}
            spellCheck={false}
            className="h-7 text-[12px]"
          />
          <Input
            value={exclude}
            onChange={(event) => setExclude(event.target.value)}
            placeholder={t("Fichiers à exclure (*.test.ts, docs)")}
            spellCheck={false}
            className="h-7 text-[12px]"
          />
        </div>
      )}

      {!query ? (
        <Empty icon={Search}>{t("Un texte ou une expression, dans les fichiers du projet hors dépendances et sorties de build.")}</Empty>
      ) : answer?.error ? (
        <p className="text-[12px] text-destructive">{answer.error}</p>
      ) : answer ? (
        <>
          <p className="text-[11px] text-muted-foreground" data-search-summary>
            {answer.files.length === 0
              ? t("Aucun résultat.")
              : t("{count} résultat(s) dans {files} fichier(s)", { count, files: answer.files.length })}
            {answer.truncated && ` — ${t("liste arrêtée : précise la recherche.")}`}
            {searching && " …"}
          </p>
          <ul className="m-0 list-none p-0">
            {answer.files.map((file) => {
              const isFolded = folded.has(file.path);
              const name = file.path.split("/").pop() ?? file.path;
              const folder = file.path.slice(0, Math.max(0, file.path.length - name.length - 1));
              return (
                <li key={file.path} data-search-file={file.path}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-[12px] hover:bg-accent"
                    onClick={() =>
                      setFolded((current) => {
                        const next = new Set(current);
                        if (next.has(file.path)) next.delete(file.path);
                        else next.add(file.path);
                        return next;
                      })
                    }
                  >
                    {isFolded ? <ChevronRight className="size-3 shrink-0" /> : <ChevronDown className="size-3 shrink-0" />}
                    <FileIcon name={name} directory={false} className="size-3.5" />
                    <span className="shrink-0">{name}</span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{folder}</span>
                    <span className="shrink-0 rounded-full bg-muted px-1.5 text-[10.5px] tabular-nums text-muted-foreground">{file.matches.length}</span>
                  </button>
                  {!isFolded && (
                    <ul className="m-0 list-none p-0 pl-5">
                      {file.matches.map((match) => (
                        <li key={`${match.line}:${match.column}`}>
                          <button
                            type="button"
                            className="flex w-full items-baseline gap-2 rounded px-1 py-0.5 text-left hover:bg-accent"
                            onClick={() => void openFile(absolute(root, file.path), { line: match.line, column: match.column })}
                          >
                            <span className="w-8 shrink-0 text-right font-mono text-[10.5px] text-muted-foreground tabular-nums">{match.line}</span>
                            <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] whitespace-pre">
                              {match.preview.slice(0, match.previewStart).trimStart()}
                              <mark className="rounded-sm bg-amber-300/50 text-foreground dark:bg-amber-400/30">
                                {match.preview.slice(match.previewStart, match.previewStart + match.length)}
                              </mark>
                              {match.preview.slice(match.previewStart + match.length)}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p className="text-[11px] text-muted-foreground">{t("recherche…")}</p>
      )}
    </div>
  );
}
