import { Search } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { Async, Empty, useAsync } from "@/components/common";
import { t } from "@/i18n";
import { api, formatDate, shortName } from "@/lib/api";
import type { SessionSummary } from "@/lib/types";
import { setState } from "@/state/store";

interface Hit {
  sessionId: string;
  index: number;
  kind: "prompt" | "command" | "answer" | "tool" | "note";
  name?: string;
  at?: string;
  snippet: string;
  title?: string;
  cwd?: string;
}

const KIND_LABEL: Record<Hit["kind"], string> = {
  prompt: "moi",
  command: "commande",
  answer: "claude",
  tool: "outil",
  note: "note",
};

/** Sans accents ni casse, comme côté serveur, pour surligner ce qui a été trouvé. */
function fold(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * Surligne les mots cherchés dans un extrait.
 *
 * Replier le texte garde sa longueur caractère pour caractère une fois les
 * diacritiques retirés un à un : les positions trouvées dans la version repliée
 * valent dans l'originale.
 */
function highlight(snippet: string, words: string[]): ReactNode[] {
  const folded = fold(snippet);
  const marks: [number, number][] = [];
  for (const word of words) {
    let from = 0;
    for (let at = folded.indexOf(word, from); at >= 0 && word; at = folded.indexOf(word, from)) {
      marks.push([at, at + word.length]);
      from = at + word.length;
    }
  }
  if (folded.length !== snippet.length || marks.length === 0) return [snippet];
  marks.sort((a, b) => a[0] - b[0]);
  const out: ReactNode[] = [];
  let cursor = 0;
  for (const [start, end] of marks) {
    if (start < cursor) continue;
    out.push(snippet.slice(cursor, start));
    out.push(
      <mark key={start} className="rounded-sm bg-primary/25 text-foreground">
        {snippet.slice(start, end)}
      </mark>,
    );
    cursor = end;
  }
  out.push(snippet.slice(cursor));
  return out;
}

/**
 * Recherche dans tout ce qui s'est dit et tapé dans les sessions : prompts,
 * réponses, commandes, appels d'outils. Un résultat ouvre sa session à l'endroit
 * trouvé.
 */
export function SearchPanel({ query }: { query: string }) {
  // Une requête par pause de frappe, pas par lettre.
  const [debounced, setDebounced] = useState(query);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const state = useAsync(
    () =>
      debounced
        ? api<{ hits: Hit[]; total: number; elapsedMs: number }>("/api/search", { q: debounced })
        : Promise.resolve({ hits: [], total: 0, elapsedMs: 0 }),
    [debounced],
  );
  const words = fold(debounced).split(/\s+/).filter(Boolean);

  if (!debounced) {
    return (
      <Empty icon={Search}>
        {t("Tape un mot, un bout de commande, un identifiant de ticket…")}
        <br />
        <span className="text-[11px]">{t("Premier passage : l'index se construit, quelques secondes.")}</span>
      </Empty>
    );
  }

  return (
    <Async state={state}>
      {({ hits, total, elapsedMs }) =>
        hits.length === 0 ? (
          <Empty icon={Search}>{t("Aucun résultat.")}</Empty>
        ) : (
          <>
            <p className="py-1 text-[11px] text-muted-foreground">
              {total > hits.length
                ? t("{total} résultats en {ms} ms, les {shown} plus récents", { total, ms: elapsedMs, shown: hits.length })
                : t("{total} résultats en {ms} ms", { total, ms: elapsedMs })}
            </p>
            <ul className="m-0 list-none p-0">
              {hits.map((hit) => (
                <li key={`${hit.sessionId}|${hit.index}`} className="border-b last:border-0">
                  <button
                    type="button"
                    className="block w-full min-w-0 rounded px-1 py-1.5 text-left hover:bg-accent/50"
                    onClick={() =>
                      setState({
                        selectedSession: {
                          sessionId: hit.sessionId,
                          ...(hit.title ? { title: hit.title } : {}),
                        } as SessionSummary,
                        followLive: false,
                        sessionMode: "activity",
                        sessionCollapsed: false,
                        activityFocus: { sessionId: hit.sessionId, index: hit.index },
                      })
                    }
                  >
                    <span className="flex items-baseline gap-2 text-[11px] text-muted-foreground">
                      <span className="w-16 shrink-0 truncate tracking-wide uppercase">
                        {hit.kind === "tool" ? hit.name : t(KIND_LABEL[hit.kind])}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {hit.title ?? hit.sessionId.slice(0, 8)}
                        {hit.cwd ? ` · ${shortName(hit.cwd)}` : ""}
                      </span>
                      <span className="shrink-0">{formatDate(hit.at)}</span>
                    </span>
                    <span
                      className={
                        hit.kind === "tool" || hit.kind === "command"
                          ? "block font-mono text-[11px] break-words"
                          : "block text-[12px] break-words"
                      }
                    >
                      {highlight(hit.snippet, words)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )
      }
    </Async>
  );
}
