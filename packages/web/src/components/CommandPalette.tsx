import { useMemo, useState } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "cn";
import { commands, effectiveShortcut, type Command } from "@/state/commands";
import { setState, useStore } from "@/state/store";
import { resizeActive } from "@/state/terminals";

/** Raccourci affiché, touche par touche. */
export function Keys({ shortcut }: { shortcut: string }) {
  return (
    <span className="flex shrink-0 gap-0.5">
      {shortcut.split("+").map((key) => (
        <kbd key={key} className="rounded border bg-muted px-1 font-mono text-[10px] text-muted-foreground">
          {key === "Shift" ? "Maj" : key === "PageDown" ? "Page suiv." : key === "PageUp" ? "Page préc." : key}
        </kbd>
      ))}
    </span>
  );
}

/** Mots de la recherche tous présents, dans l'ordre qu'on veut : « onglet claude » trouve « Nouvel onglet Claude ». */
function matches(command: Command, query: string): boolean {
  const haystack = `${command.group} ${command.label}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/**
 * Palette de commandes : toute action, avec son raccourci affiché.
 *
 * Elle rend les raccourcis découvrables. Fermée, elle rend le focus au terminal :
 * la touche qui l'a ouverte a été prise avant lui, et rien n'y reste tapé.
 */
export function CommandPalette() {
  const open = useStore((state) => state.paletteOpen);
  const overrides = useStore((state) => state.shortcuts);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);

  const all = useMemo(() => (open ? commands().filter((command) => command.id !== "palette") : []), [open]);
  const shown = all.filter((command) => matches(command, query));

  const close = () => {
    setState({ paletteOpen: false });
    setQuery("");
    setCursor(0);
    requestAnimationFrame(resizeActive);
  };
  const run = (command: Command | undefined) => {
    if (!command) return;
    close();
    // Après la fermeture : une commande qui ouvre un dialogue ne doit pas le voir
    // refermé avec la palette.
    requestAnimationFrame(command.run);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="top-[20%] translate-y-0 gap-0 p-0 sm:max-w-lg" showCloseButton={false}>
        <DialogTitle className="sr-only">Palette de commandes</DialogTitle>
        <DialogDescription className="sr-only">Chercher une action et la lancer.</DialogDescription>
        <input
          autoFocus
          value={query}
          placeholder="Chercher une action…"
          className="w-full border-b bg-transparent px-3 py-2.5 text-[13px] outline-none"
          onChange={(event) => {
            setQuery(event.target.value);
            setCursor(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setCursor((value) => Math.min(value + 1, shown.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setCursor((value) => Math.max(value - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              run(shown[cursor]);
            }
          }}
        />
        <ul className="m-0 max-h-80 list-none overflow-auto p-1">
          {shown.length === 0 && <li className="px-2 py-3 text-center text-[12px] text-muted-foreground">Aucune action.</li>}
          {shown.map((command, index) => {
            const shortcut = effectiveShortcut(command, overrides);
            return (
              <li
                key={command.id}
                onMouseEnter={() => setCursor(index)}
                onClick={() => run(command)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[12.5px]",
                  index === cursor && "bg-accent",
                )}
              >
                <span className="w-20 shrink-0 text-[11px] text-muted-foreground">{command.group}</span>
                <span className="min-w-0 flex-1 truncate">{command.label}</span>
                {shortcut && <Keys shortcut={shortcut} />}
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
