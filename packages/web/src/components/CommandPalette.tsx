import { useEffect, useMemo, useState } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "cn";
import { t } from "@/i18n";
import { api, formatDate, shortName } from "@/lib/api";
import { bindingsOf } from "@/lib/keymap";
import type { SessionSummary } from "@/lib/types";
import { commands, type Command } from "@/state/commands";
import { openFile } from "@/state/editor";
import { getState, selectSession, setBottomMode, setState, useStore } from "@/state/store";
import { resizeActive } from "@/state/terminals";

/** Raccourci affiché, touche par touche. */
export function Keys({ shortcut }: { shortcut: string }) {
  return (
    <span className="flex shrink-0 gap-0.5">
      {shortcut.split("+").map((key) => (
        <kbd key={key} className="rounded border bg-muted px-1 font-mono text-[10px] text-muted-foreground">
          {key === "Shift" ? t("Maj") : key === "PageDown" ? t("Page suiv.") : key === "PageUp" ? t("Page préc.") : key}
        </kbd>
      ))}
    </span>
  );
}

/** Une ligne de la palette, quelle que soit sa source. */
interface Entry {
  id: string;
  /** Colonne de gauche : le groupe d'une commande, la date d'une session. */
  aside?: string;
  label: string;
  detail?: string;
  shortcut?: string;
  run: () => void;
}

type Mode = "files" | "commands" | "sessions" | "search";

/** La source se lit au premier caractère, comme dans VS Code. */
function modeOf(query: string): { mode: Mode; text: string } {
  const first = query[0];
  if (first === ">") return { mode: "commands", text: query.slice(1).trim() };
  if (first === "@") return { mode: "sessions", text: query.slice(1).trim() };
  if (first === "#") return { mode: "search", text: query.slice(1).trim() };
  return { mode: "files", text: query.trim() };
}

const PLACEHOLDER: Record<Mode, string> = {
  files: "Fichier du projet — > commandes, @ sessions, # recherche",
  commands: "Chercher une action…",
  sessions: "Chercher une session…",
  search: "Chercher dans les sessions…",
};

/** Mots de la recherche tous présents, dans l'ordre qu'on veut : « onglet claude » trouve « Nouvel onglet Claude ». */
function hasWords(haystack: string, query: string): boolean {
  const lower = haystack.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => lower.includes(word));
}

/** Commandes lancées depuis la palette, les plus récentes d'abord ; elles remontent en tête. */
const RECENT_KEY = "clide.recentCommands";

function recentCommands(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function rememberCommand(id: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...recentCommands().filter((known) => known !== id)].slice(0, 12)));
  } catch {
    // Mémoire du navigateur bloquée : l'ordre reste celui des groupes.
  }
}

/** Valeur qui ne suit la saisie qu'une fois la frappe retombée : chaque touche ne relance pas une requête. */
function useDebounced<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

interface Hit {
  sessionId: string;
  index: number;
  snippet: string;
  title?: string;
  at?: string;
}

/** Les lignes d'une source, chargées au besoin. */
function useEntries(open: boolean, mode: Mode, text: string): { entries: Entry[]; loading: boolean } {
  const debounced = useDebounced(text, mode === "search" ? 250 : 120);
  const [remote, setRemote] = useState<{ key: string; entries: Entry[] }>({ key: "", entries: [] });
  const [sessions, setSessions] = useState<SessionSummary[]>();
  const root = useStore((state) => state.activeRoot);

  const all = useMemo(() => (open ? commands().filter((command) => command.id !== "palette") : []), [open]);

  useEffect(() => {
    if (!open) {
      setSessions(undefined);
      return;
    }
    if (mode === "sessions" && !sessions) {
      void api<{ sessions: SessionSummary[] }>("/api/sessions")
        .then((result) => setSessions(result.sessions))
        .catch(() => setSessions([]));
    }
  }, [open, mode, sessions]);

  const key = `${mode}|${debounced}|${root}`;
  useEffect(() => {
    if (!open || (mode !== "files" && mode !== "search")) return;
    let alive = true;
    const load = async (): Promise<Entry[]> => {
      if (mode === "files") {
        if (!root) return [];
        const { files } = await api<{ files: string[] }>("/api/files/find", { root, q: debounced });
        return files.map((path) => ({
          id: `file:${path}`,
          label: shortName(path),
          ...(path.includes("/") ? { detail: path.slice(0, path.lastIndexOf("/")) } : {}),
          run: () => void openFile(`${root}\\${path.replace(/\//g, "\\")}`),
        }));
      }
      if (debounced.length < 2) return [];
      const { hits } = await api<{ hits: Hit[] }>("/api/search", { q: debounced });
      return hits.slice(0, 50).map((hit) => ({
        id: `hit:${hit.sessionId}:${hit.index}`,
        aside: formatDate(hit.at).slice(0, 10),
        label: hit.snippet,
        ...(hit.title ? { detail: hit.title } : {}),
        run: () => {
          selectSession({ sessionId: hit.sessionId, ...(hit.title ? { title: hit.title } : {}) } as SessionSummary);
          setBottomMode("activity");
          setState({ sessionCollapsed: false, activityFocus: { sessionId: hit.sessionId, index: hit.index } });
        },
      }));
    };
    load()
      .then((entries) => alive && setRemote({ key, entries }))
      .catch(() => alive && setRemote({ key, entries: [] }));
    return () => {
      alive = false;
    };
  }, [open, mode, debounced, root, key]);

  if (mode === "commands") {
    const { keymap, shortcuts } = getState();
    const recent = recentCommands();
    const rank = (command: Command) => {
      const index = recent.indexOf(command.id);
      return index === -1 ? recent.length : index;
    };
    const entries = all
      .filter((command) => hasWords(`${command.group} ${command.label}`, text))
      .sort((a, b) => rank(a) - rank(b))
      .map((command) => {
        const shortcut = bindingsOf(command, keymap, shortcuts)[0]?.key;
        return {
          id: command.id,
          aside: command.group,
          label: command.label,
          ...(shortcut ? { shortcut } : {}),
          run: () => {
            rememberCommand(command.id);
            command.run();
          },
        };
      });
    return { entries, loading: false };
  }

  if (mode === "sessions") {
    const entries = (sessions ?? [])
      .filter((session) =>
        hasWords(`${session.title ?? ""} ${session.lastPrompt ?? ""} ${session.projectDir} ${session.gitBranch ?? ""}`, text),
      )
      .slice(0, 50)
      .map((session) => ({
        id: `session:${session.sessionId}`,
        aside: formatDate(session.lastActivityAt).slice(0, 10),
        label: session.title ?? session.lastPrompt ?? session.sessionId.slice(0, 8),
        detail: [shortName(session.effectiveCwd ?? session.projectDir), session.gitBranch].filter(Boolean).join(" · "),
        run: () => {
          selectSession(session);
          setState({ sessionCollapsed: false, activityFocus: null });
        },
      }));
    return { entries, loading: sessions === undefined };
  }

  return { entries: remote.key === key ? remote.entries : [], loading: remote.key !== key };
}

/**
 * Palette : les fichiers du projet, les commandes (`>`), les sessions (`@`) et
 * la recherche dans les sessions (`#`), comme la palette de VS Code.
 *
 * Elle rend les raccourcis découvrables. Fermée, elle rend le focus au terminal :
 * la touche qui l'a ouverte a été prise avant lui, et rien n'y reste tapé.
 */
export function CommandPalette() {
  const open = useStore((state) => state.paletteOpen);
  const initial = useStore((state) => state.paletteQuery);
  const root = useStore((state) => state.activeRoot);
  const [query, setQuery] = useState(initial);
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    if (open) {
      setQuery(initial);
      setCursor(0);
    }
  }, [open, initial]);

  const { mode, text } = modeOf(query);
  const { entries, loading } = useEntries(open, mode, text);

  const close = () => {
    setState({ paletteOpen: false });
    setCursor(0);
    requestAnimationFrame(resizeActive);
  };
  const run = (entry: Entry | undefined) => {
    if (!entry) return;
    close();
    // Après la fermeture : une commande qui ouvre un dialogue ne doit pas le voir
    // refermé avec la palette.
    requestAnimationFrame(entry.run);
  };

  const empty = loading
    ? t("Recherche…")
    : mode === "files" && !root
      ? t("Aucun projet ouvert.")
      : mode === "search" && text.length < 2
        ? t("Deux lettres au moins.")
        : t("Rien ne correspond.");

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="top-[20%] translate-y-0 gap-0 p-0 sm:max-w-lg" showCloseButton={false}>
        <DialogTitle className="sr-only">{t("Palette de commandes")}</DialogTitle>
        <DialogDescription className="sr-only">{t("Chercher une action et la lancer.")}</DialogDescription>
        <input
          autoFocus
          value={query}
          placeholder={t(PLACEHOLDER[mode])}
          className="w-full border-b bg-transparent px-3 py-2.5 text-[13px] outline-none"
          onChange={(event) => {
            setQuery(event.target.value);
            setCursor(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setCursor((value) => Math.min(value + 1, entries.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setCursor((value) => Math.max(value - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              run(entries[cursor]);
            }
          }}
        />
        <ul className="m-0 max-h-80 list-none overflow-auto p-1">
          {entries.length === 0 && <li className="px-2 py-3 text-center text-[12px] text-muted-foreground">{empty}</li>}
          {entries.map((entry, index) => (
            <li
              key={entry.id}
              onMouseEnter={() => setCursor(index)}
              onClick={() => run(entry)}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[12.5px]",
                index === cursor && "bg-accent",
              )}
            >
              {entry.aside && <span className="w-20 shrink-0 truncate text-[11px] text-muted-foreground">{entry.aside}</span>}
              <span className="min-w-0 flex-1 truncate">
                {entry.label}
                {entry.detail && <span className="ml-2 text-[11px] text-muted-foreground">{entry.detail}</span>}
              </span>
              {entry.shortcut && <Keys shortcut={entry.shortcut} />}
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
