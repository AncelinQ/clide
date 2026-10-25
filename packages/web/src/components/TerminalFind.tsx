import type { ISearchOptions } from "@xterm/addon-search";
import { CaseSensitive, ChevronDown, ChevronUp, Regex, WholeWord, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { Toggle } from "@/components/common";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { findDecorations, findStatus, type FindResult } from "@/lib/terminal-find";
import { closeTerminalFind, searchOf } from "@/state/terminals";
import { cn } from "cn";

/** Une couleur CSS quelconque telle qu'un canevas la rend, `#rrggbb` ou `rgba(…)`. */
function canvasColor(color: string): string {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return color;
  context.fillStyle = color;
  return context.fillStyle;
}

/** Surlignage tiré du thème en cours : relu à chaque recherche, il suit un changement de thème. */
function currentDecorations(): ReturnType<typeof findDecorations> {
  const styles = getComputedStyle(document.documentElement);
  return findDecorations(canvasColor(styles.getPropertyValue("--primary").trim()), canvasColor(styles.getPropertyValue("--term-bg").trim()));
}

/**
 * Barre de recherche d'un terminal, historique compris : Entrée et Maj+Entrée
 * vont au résultat suivant et au précédent, Échap rend le clavier au terminal.
 * Les résultats sont surlignés dans le terminal et marqués dans sa marge.
 *
 * `request` change à chaque ouverture demandée : la barre reprend alors le texte
 * sélectionné (`seed`) et le focus, sans perdre sa recherche ni ses options.
 */
export function TerminalFind({
  terminalId,
  request,
  seed,
  className,
}: {
  terminalId: string;
  request: number;
  seed: string;
  className?: string;
}) {
  const search = searchOf(terminalId);
  const [query, setQuery] = useState(seed);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [result, setResult] = useState<FindResult>();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (seed) setQuery(seed);
    // Au rendu suivant : le champ porte alors le texte repris, qu'on sélectionne.
    const frame = requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [request, seed]);

  useEffect(() => {
    if (!search) return;
    const subscription = search.onDidChangeResults(({ resultIndex, resultCount }) =>
      setResult({ index: resultIndex, count: resultCount }),
    );
    return () => {
      subscription.dispose();
      search.clearDecorations();
    };
  }, [search]);

  const options = (incremental: boolean): ISearchOptions => ({
    caseSensitive,
    wholeWord,
    regex,
    incremental,
    decorations: currentDecorations(),
  });

  /** Lance une recherche ; une expression régulière invalide le dit au lieu de lever. */
  const find = (direction: "next" | "previous", incremental = false) => {
    if (!search || !query) return;
    try {
      if (direction === "next") search.findNext(query, options(incremental));
      else search.findPrevious(query, options(false));
    } catch {
      search.clearDecorations();
      setResult({ invalid: true });
    }
  };

  const lastOptions = useRef("");

  // À chaque frappe ou option, le terminal suit : le résultat courant s'étend s'il correspond encore.
  useEffect(() => {
    if (!search) return;
    if (!query) {
      search.clearDecorations();
      setResult(undefined);
      return;
    }
    // L'addon ne recalcule pas ses surlignages quand seule une option change :
    // effacés, ils repartent de zéro.
    const optionsKey = [caseSensitive, wholeWord, regex].join();
    if (optionsKey !== lastOptions.current) search.clearDecorations();
    lastOptions.current = optionsKey;
    find("next", true);
    // `find` lit ces mêmes valeurs : elles sont toutes dans les dépendances.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, query, caseSensitive, wholeWord, regex]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    closeTerminalFind(terminalId);
  };

  // Une option cliquée rend le focus au champ : on continue de taper.
  const toggle = (set: (update: (value: boolean) => boolean) => void) => () => {
    set((value) => !value);
    input.current?.focus();
  };

  const status = findStatus(query ? result : undefined);

  return (
    <div
      role="search"
      aria-label={t("Rechercher dans le terminal")}
      className={cn(
        "absolute right-4 z-10 flex max-w-[calc(100%-2rem)] items-center gap-0.5 rounded-md border bg-card p-0.5 shadow-sm focus-within:ring-1 focus-within:ring-ring",
        className,
      )}
      onKeyDown={onKeyDown}
      data-terminal-find
    >
      <input
        ref={input}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          find(event.shiftKey ? "previous" : "next");
        }}
        aria-label={t("Rechercher dans le terminal")}
        placeholder={t("Rechercher dans le terminal")}
        spellCheck={false}
        className="h-6 w-48 min-w-0 shrink bg-transparent px-1.5 text-[12px] outline-none placeholder:text-muted-foreground"
      />
      <Toggle on={caseSensitive} title={t("Respecter la casse")} onClick={toggle(setCaseSensitive)}>
        <CaseSensitive className="size-4" />
      </Toggle>
      <Toggle on={wholeWord} title={t("Mot entier")} onClick={toggle(setWholeWord)}>
        <WholeWord className="size-4" />
      </Toggle>
      <Toggle on={regex} title={t("Expression régulière")} onClick={toggle(setRegex)}>
        <Regex className="size-4" />
      </Toggle>
      <span
        role="status"
        className={cn(
          "min-w-16 shrink-0 px-1 text-center text-[11px] whitespace-nowrap tabular-nums text-muted-foreground",
          result && "invalid" in result && query && "text-destructive",
        )}
      >
        {status.text && t(status.text, status.values)}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="size-6 shrink-0"
        title={t("Résultat précédent (Maj+Entrée)")}
        aria-label={t("Résultat précédent")}
        disabled={!query}
        onClick={() => find("previous")}
      >
        <ChevronUp className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-6 shrink-0"
        title={t("Résultat suivant (Entrée)")}
        aria-label={t("Résultat suivant")}
        disabled={!query}
        onClick={() => find("next")}
      >
        <ChevronDown className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-6 shrink-0"
        title={t("Fermer (Échap)")}
        aria-label={t("Fermer la recherche")}
        onClick={() => closeTerminalFind(terminalId)}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
