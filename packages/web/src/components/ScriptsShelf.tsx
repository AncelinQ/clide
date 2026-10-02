import {
  ArrowUpToLine,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Ellipsis,
  FlaskConical,
  Hammer,
  ListChecks,
  Package,
  Play,
  RotateCw,
  Server,
  Sparkles,
  Square,
  SquareTerminal,
  X,
  type LucideIcon,
} from "lucide-react";
import { useState, type KeyboardEvent } from "react";

import { ContextArea } from "@/components/Menu";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import type { MenuItem } from "@/lib/menu";
import { shelfGroups, shelfSummary, type Nature, type ShelfTone } from "@/lib/script-shelf";
import type { TerminalInfo } from "@/lib/types";
import { cn } from "cn";
import {
  canRelaunch,
  closeFinishedScripts,
  finishedScripts,
  hasRunningScripts,
  place,
  relaunch,
  stopAllScripts,
  toggleFolded,
  toggleScripts,
} from "@/state/shelf";
import { activeProject, useStore } from "@/state/store";
import { closeTerminal, focusTerminal, interruptTerminal } from "@/state/terminals";

const NATURE_LABEL: Record<Nature, string> = {
  server: "Serveurs",
  test: "Tests",
  build: "Build",
  check: "Vérifications",
  install: "Installation",
  other: "Autres",
  shell: "Shells",
};

const NATURE_ICON: Record<Nature, LucideIcon> = {
  server: Server,
  test: FlaskConical,
  build: Hammer,
  check: ListChecks,
  install: Download,
  other: Ellipsis,
  shell: SquareTerminal,
};

const TONE_TEXT: Record<ShelfTone, string> = {
  none: "",
  idle: "",
  running: "text-amber-500",
  failed: "text-destructive",
};

const TONE_DOT: Record<ShelfTone, string> = {
  none: "hidden",
  idle: "hidden",
  running: "bg-amber-500",
  failed: "bg-destructive",
};

/**
 * L'onglet épinglé en tête de la barre : il bascule vers les scripts du projet et
 * en revient. Il dit combien tournent, si l'un a échoué, et si une session rangée
 * là attend une réponse. Grisé tant qu'aucun script n'a été lancé.
 */
export function ScriptsTab({ shelf, shown }: { shelf: TerminalInfo[]; shown: boolean }) {
  const attention = useStore((state) => state.attention);
  const summary = shelfSummary(shelf, attention);
  const empty = shelf.length === 0;
  const button = (
    <button
      type="button"
      data-scripts-tab
      disabled={empty}
      onClick={toggleScripts}
      title={
        empty
          ? t("Aucun script lancé dans ce projet")
          : summary.running > 0
            ? t("Scripts — {count} en cours", { count: summary.running })
            : t("Scripts du projet")
      }
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 transition-colors disabled:cursor-default disabled:opacity-40",
        shown
          ? "border-border bg-muted text-foreground"
          : "border-transparent text-muted-foreground enabled:hover:bg-accent enabled:hover:text-foreground",
      )}
    >
      <Package className={cn("size-3.5", TONE_TEXT[summary.tone])} />
      <span>{t("Scripts")}</span>
      {/* Le compte est celui des scripts en cours, ambre comme eux ; un échec ne colore que l'icône. */}
      {summary.running > 0 && (
        <span className="rounded bg-amber-500/15 px-1 text-[10px] font-medium text-amber-600 tabular-nums dark:text-amber-400">
          {summary.running}
        </span>
      )}
      {summary.attention && <span className="size-1.5 rounded-full bg-primary" />}
    </button>
  );
  if (empty) return button;
  return (
    <ContextArea
      items={(): MenuItem[] => [
        { kind: "item", label: t("Tout arrêter"), icon: Square, disabled: !hasRunningScripts(), run: stopAllScripts },
        { kind: "item", label: t("Fermer les scripts finis"), icon: X, disabled: finishedScripts().length === 0, run: closeFinishedScripts },
      ]}
    >
      {button}
    </ContextArea>
  );
}

/**
 * Arrêter, relancer : ce qu'un script propose selon son état, sur sa ligne comme
 * dans la barre flottante. Un onglet où Claude tourne n'en propose aucun, et un
 * shell sans commande connue ne se relance pas.
 */
export function ScriptButtons({ info, close = false, className }: { info: TerminalInfo; close?: boolean; className?: string }) {
  const relaunchable = useStore((state) => canRelaunch(state, info));
  if (info.kind === "claude") {
    return close ? <CloseButton info={info} className={className} /> : null;
  }
  const running = info.state === "running" && !info.exited;
  return (
    <>
      {running && (
        <Button
          variant="ghost"
          size="icon"
          className={cn("size-6 shrink-0", className)}
          title={t("Arrêter (Ctrl+C)")}
          onClick={(event) => {
            event.stopPropagation();
            interruptTerminal(info.id, { show: false });
          }}
        >
          <Square className="size-3" />
        </Button>
      )}
      {relaunchable && (
        <Button
          variant="ghost"
          size="icon"
          className={cn("size-6 shrink-0", className)}
          title={running ? t("Relancer (arrête puis relance)") : t("Relancer")}
          onClick={(event) => {
            event.stopPropagation();
            void relaunch(info.id);
          }}
        >
          {running ? <RotateCw className="size-3.5" /> : <Play className="size-3.5" />}
        </Button>
      )}
      {close && !running && <CloseButton info={info} className={className} />}
    </>
  );
}

function CloseButton({ info, className }: { info: TerminalInfo; className?: string | undefined }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("size-6 shrink-0", className)}
      title={t("Fermer")}
      onClick={(event) => {
        event.stopPropagation();
        closeTerminal(info.id);
      }}
    >
      <X className="size-3.5" />
    </Button>
  );
}

/** L'état d'une ligne : ✳ pour une session Claude, un point coloré pour un script, ✕ pour un shell terminé. */
function StateGlyph({ info }: { info: TerminalInfo }) {
  if (info.kind === "claude") {
    return (
      <Sparkles
        className={cn(
          "mt-0.5 size-3 shrink-0",
          info.state === "running" ? "text-amber-500" : info.state === "failed" ? "text-destructive" : "text-primary",
        )}
      />
    );
  }
  if (info.exited) return <X className="mt-0.5 size-3 shrink-0 text-muted-foreground" />;
  return (
    <span
      className={cn(
        "mt-1 size-2 shrink-0 rounded-full",
        info.state === "running"
          ? "bg-amber-500"
          : info.state === "failed"
            ? "bg-destructive"
            : "border border-muted-foreground",
      )}
    />
  );
}

type Row = { kind: "header"; key: string; nature: Nature; tabs: TerminalInfo[] } | { kind: "line"; key: string; info: TerminalInfo };

/**
 * La liste de l'onglet Scripts, à gauche du terminal montré.
 *
 * Les scripts sont groupés par nature ; avec au moins deux groupes, chacun a un
 * en-tête qui se replie, et qui garde replié la couleur et l'attention de ses
 * lignes. Le clavier la parcourt comme un arbre : `↑` `↓` d'une ligne visible à
 * l'autre en montrant chaque script sans quitter la liste, `←` `→` pour replier
 * et déplier, Entrée pour passer au terminal.
 */
export function ScriptsList({ shelf, shownId, width }: { shelf: TerminalInfo[]; shownId: string | null; width: number }) {
  const folded = useStore((state) => activeProject(state)?.scripts.folded ?? []);
  const attention = useStore((state) => state.attention);
  const [cursor, setCursor] = useState<string>();
  const groups = shelfGroups(shelf);
  const headed = groups.length > 1;
  const rows: Row[] = groups.flatMap((group): Row[] => [
    ...(headed ? [{ kind: "header" as const, key: `group:${group.nature}`, nature: group.nature, tabs: group.tabs }] : []),
    ...(headed && folded.includes(group.nature) ? [] : group.tabs.map((info) => ({ kind: "line" as const, key: info.id, info }))),
  ]);
  const at = rows.findIndex((row) => row.key === (cursor && rows.some((item) => item.key === cursor) ? cursor : shownId));

  const move = (index: number) => {
    const row = rows[Math.max(0, Math.min(rows.length - 1, index))];
    if (!row) return;
    setCursor(row.key);
    if (row.kind === "line") focusTerminal(row.info.id, { focus: false });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const row = rows[at];
    const handled = (() => {
      switch (event.key) {
        case "ArrowDown":
          move(at + 1);
          return true;
        case "ArrowUp":
          move(at === -1 ? rows.length - 1 : at - 1);
          return true;
        case "ArrowLeft":
          if (row?.kind === "header" && !folded.includes(row.nature)) toggleFolded(row.nature);
          else if (row?.kind === "line" && headed) setCursor(`group:${groups.find((group) => group.tabs.includes(row.info))?.nature}`);
          return true;
        case "ArrowRight":
          if (row?.kind === "header" && folded.includes(row.nature)) toggleFolded(row.nature);
          return true;
        case "Enter":
        case " ":
          if (row?.kind === "header") toggleFolded(row.nature);
          else if (row?.kind === "line" && event.key === "Enter") focusTerminal(row.info.id);
          return true;
        default:
          return false;
      }
    })();
    if (handled) event.preventDefault();
  };

  return (
    <div
      role="tree"
      tabIndex={0}
      aria-label={t("Scripts")}
      data-scripts-list
      onKeyDown={onKeyDown}
      style={{ width }}
      className="flex min-h-0 min-w-[140px] max-w-[40%] shrink-0 flex-col gap-px overflow-y-auto rounded-lg border p-1 text-[12px] outline-none focus-visible:border-primary"
    >
      {rows.map((row, index) => {
        if (row.kind === "header") {
          const isFolded = folded.includes(row.nature);
          const summary = shelfSummary(row.tabs, attention);
          const Icon = NATURE_ICON[row.nature];
          return (
            <div
              key={row.key}
              role="treeitem"
              aria-expanded={!isFolded}
              aria-level={1}
              className={cn(
                "flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase hover:bg-accent hover:text-foreground",
                index > 0 && "mt-1",
                index === at && "bg-accent/60",
              )}
              onClick={() => {
                setCursor(row.key);
                toggleFolded(row.nature);
              }}
            >
              {isFolded ? <ChevronRight className="size-3 shrink-0" /> : <ChevronDown className="size-3 shrink-0" />}
              <Icon className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{t(NATURE_LABEL[row.nature])}</span>
              {isFolded && <span className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[summary.tone])} />}
              {isFolded && summary.attention && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}
              <span className="tabular-nums">{row.tabs.length}</span>
            </div>
          );
        }
        const { info } = row;
        const shown = info.id === shownId;
        return (
          <ContextArea
            key={row.key}
            items={(): MenuItem[] => [
              { kind: "item", label: t("Sortir des scripts"), icon: ArrowUpToLine, run: () => place(info.id, "bar") },
              { kind: "separator" },
              { kind: "item", label: t("Fermer"), icon: X, run: () => closeTerminal(info.id) },
              { kind: "separator" },
              {
                kind: "item",
                label: t("Copier le dossier de l'onglet"),
                icon: Copy,
                run: () => void navigator.clipboard.writeText(info.cwd),
              },
            ]}
          >
            <div
              role="treeitem"
              aria-selected={shown}
              aria-level={headed ? 2 : 1}
              title={info.cwd}
              className={cn(
                "group flex cursor-pointer items-start gap-2 rounded py-1 pr-0.5",
                headed ? "pl-3" : "pl-1.5",
                shown ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                index === at && !shown && "bg-accent/60",
              )}
              onClick={() => {
                setCursor(row.key);
                focusTerminal(info.id);
              }}
            >
              <StateGlyph info={info} />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{info.title}</span>
                {info.devUrl && (
                  <a
                    href={info.devUrl}
                    target="_blank"
                    rel="noreferrer"
                    title={info.devUrl}
                    onClick={(event) => event.stopPropagation()}
                    className="block truncate font-mono text-[10.5px] text-muted-foreground hover:text-foreground hover:underline"
                  >
                    {info.devUrl.replace(/^https?:\/\//, "")}
                  </a>
                )}
              </span>
              {attention[info.id] && <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />}
              <span className={cn("-my-0.5 flex shrink-0", !shown && "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100")}>
                <ScriptButtons info={info} close />
              </span>
            </div>
          </ContextArea>
        );
      })}
    </div>
  );
}
