import {
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  Copy,
  Eye,
  EyeOff,
  FilePlus,
  FolderPlus,
  ListCollapse,
  RefreshCw,
  Scissors,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";

import { NameInput } from "@/components/common";
import { FileIcon } from "@/components/FileIcon";
import { FilePreviewDialog } from "@/components/FilePreview";
import { ContextArea, type MenuItem } from "@/components/Menu";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { t } from "@/i18n";
import { PATHS_MIME, api, post, quotePath } from "@/lib/api";
import { baseName, fs, parentPath, type OnConflict, type Outcome } from "@/lib/fs";
import type { DirectoryEntry, DirectoryListing } from "@/lib/types";
import { openProject, setState, useStore, type Project } from "@/state/store";
import { followRename, openFile as openInEditor } from "@/state/editor";
import { openTerminal, typeIntoActive } from "@/state/terminals";
import { cn } from "cn";

/** Une ligne visible de l'arbre : un élément et sa profondeur. */
interface Row {
  entry: DirectoryEntry;
  depth: number;
}

/** Ce qu'on annule par Ctrl+Z, avec de quoi le défaire. */
type Undoable =
  | { kind: "create"; path: string }
  | { kind: "rename"; from: string; to: string }
  | { kind: "move"; moved: { source: string; target: string }[] }
  | { kind: "copy"; targets: string[] };

/** Presse-papiers de l'explorateur, propre à Clide : copier ou couper, puis coller ailleurs. */
let clipboard: { mode: "copy" | "cut"; paths: string[] } | undefined;

/**
 * Dossiers dépliés et pile d'annulation de chaque projet, le temps de la page.
 * L'arbre est monté une fois par projet (`key`) : il reprend les siens en montant.
 */
const expandedByRoot = new Map<string, Set<string>>();
const undoByRoot = new Map<string, Undoable[]>();

/** Élément en cours de saisie : un renommage, ou une création dans un dossier. */
type Editing = { kind: "rename"; path: string } | { kind: "create"; parent: string; type: "file" | "dir" };

/** Opération qui attend un choix : des noms sont déjà pris dans la cible. */
interface Pending {
  mode: "copy" | "move";
  sources: string[];
  targetDir: string;
  conflicts: string[];
}

/**
 * Arbre des fichiers du projet, avec ce que fait l'Explorateur de Windows :
 * créer, renommer, copier, couper, coller, glisser-déposer, mettre à la corbeille,
 * annuler. Tout passe par le serveur, qui borne chaque chemin aux projets ouverts.
 */
export function FileTree({ project }: { project: Project }) {
  const root = project.root;
  const showHidden = useStore((state) => state.showHidden);
  const [listings, setListings] = useState<Record<string, DirectoryEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => expandedByRoot.get(root) ?? new Set());
  const [selection, setSelection] = useState<string[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [editing, setEditing] = useState<Editing>();
  const [previewing, setPreviewing] = useState<string>();
  const [pending, setPending] = useState<Pending>();
  const [dropTarget, setDropTarget] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const list = useRef<HTMLUListElement>(null);

  /** Une opération refusée (nom pris, hors des projets) le dit au-dessus de l'arbre ; rien n'est perdu. */
  const report = (error: unknown) => {
    console.error("[clide]", error);
    setFailure(error instanceof Error ? error.message : String(error));
  };

  useEffect(() => {
    expandedByRoot.set(root, expanded);
  }, [root, expanded]);

  /** Relit un dossier, par son chemin relatif à la racine (`""` pour elle). */
  const load = useCallback(
    async (relativePath: string) => {
      try {
        const listing = await api<DirectoryListing>("/api/files", {
          root,
          path: relativePath,
          ...(showHidden ? { hidden: 1 } : {}),
        });
        setListings((current) => ({ ...current, [relativePath]: listing.entries }));
      } catch {
        // Dossier disparu entre-temps : on le replie.
        setExpanded((current) => {
          const next = new Set(current);
          next.delete(relativePath);
          return next;
        });
      }
    },
    [root, showHidden],
  );

  useEffect(() => {
    void load("");
    for (const path of expanded) void load(path);
    // Au changement de projet ou de filtre seulement : `expanded` se charge au dépliage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const relativeOf = useCallback(
    (path: string) => (path.length <= root.length ? "" : path.slice(root.length + 1)),
    [root],
  );

  /** Relit les dossiers touchés par une opération : ceux des chemins, ou leurs parents. */
  const refresh = useCallback(
    (paths: string[]) => {
      const dirs = new Set(paths.map((path) => relativeOf(parentPath(path))));
      for (const dir of dirs) if (dir === "" || expanded.has(dir)) void load(dir);
    },
    [expanded, load, relativeOf],
  );

  const rows = useMemo(() => {
    const out: Row[] = [];
    const walk = (relativePath: string, depth: number) => {
      for (const entry of listings[relativePath] ?? []) {
        out.push({ entry, depth });
        if (entry.directory && expanded.has(entry.relativePath)) walk(entry.relativePath, depth + 1);
      }
    };
    walk("", 0);
    return out;
  }, [listings, expanded]);

  const toggle = (entry: DirectoryEntry, open?: boolean) => {
    const opening = open ?? !expanded.has(entry.relativePath);
    setExpanded((current) => {
      const next = new Set(current);
      if (opening) next.add(entry.relativePath);
      else next.delete(entry.relativePath);
      return next;
    });
    if (opening) void load(entry.relativePath);
  };

  const remember = (operation: Undoable) => {
    const stack = undoByRoot.get(root) ?? [];
    stack.push(operation);
    undoByRoot.set(root, stack.slice(-50));
  };

  /** Dossier où créer ou coller : celui sélectionné, le parent d'un fichier sélectionné, sinon la racine. */
  const targetDir = (): string => {
    const current = rows.find((row) => row.entry.path === cursor)?.entry;
    if (!current) return root;
    return current.directory ? current.path : parentPath(current.path);
  };

  const runTransfer = async (mode: "copy" | "move", sources: string[], dir: string, onConflict: OnConflict = "ask") => {
    // Coller une copie à côté de l'original, comme dans l'Explorateur de Windows,
    // en fait « nom (2) » sans rien demander : écraser l'original n'a pas de sens.
    if (mode === "copy" && onConflict === "ask" && sources.every((source) => parentPath(source) === dir)) onConflict = "keepBoth";
    try {
      const outcomes: Outcome[] = await (mode === "copy" ? fs.copy(sources, dir, onConflict) : fs.move(sources, dir, onConflict));
      const conflicts = outcomes.filter((outcome) => outcome.conflict && outcome.status === "skipped");
      if (conflicts.length > 0) {
        setPending({ mode, sources, targetDir: dir, conflicts: conflicts.map((outcome) => baseName(outcome.target)) });
        return;
      }
      const done = outcomes.filter((outcome) => outcome.status === "done" && outcome.source !== outcome.target);
      if (done.length === 0) return;
      if (mode === "copy") remember({ kind: "copy", targets: done.map((outcome) => outcome.target) });
      else {
        remember({ kind: "move", moved: done.map(({ source, target }) => ({ source, target })) });
        for (const { source, target } of done) followRename(source, target);
      }
      refresh([...done.map((outcome) => outcome.target), ...(mode === "move" ? done.map((outcome) => outcome.source) : [])]);
      if (dir !== root) toggle({ relativePath: relativeOf(dir) } as DirectoryEntry, true);
      setSelection(done.map((outcome) => outcome.target));
    } catch (error) {
      report(error);
    }
  };

  const trash = async (paths: string[]) => {
    if (paths.length === 0) return;
    try {
      await fs.trash(paths);
      setSelection([]);
      refresh(paths);
    } catch (error) {
      report(error);
    }
  };

  const undo = async () => {
    const operation = undoByRoot.get(root)?.pop();
    if (!operation) return;
    try {
      switch (operation.kind) {
        case "create":
          await fs.trash([operation.path]);
          refresh([operation.path]);
          break;
        case "copy":
          await fs.trash(operation.targets);
          refresh(operation.targets);
          break;
        case "rename":
          await fs.rename(operation.to, baseName(operation.from));
          refresh([operation.from]);
          break;
        case "move":
          for (const { source, target } of operation.moved) await fs.move([target], parentPath(source));
          refresh(operation.moved.flatMap(({ source, target }) => [source, target]));
          break;
      }
    } catch (error) {
      report(error);
    }
  };

  const paste = () => {
    if (!clipboard) return;
    const { mode, paths } = clipboard;
    if (mode === "cut") clipboard = undefined;
    void runTransfer(mode === "cut" ? "move" : "copy", paths, targetDir());
  };

  const selectRow = (path: string, event: { ctrlKey: boolean; shiftKey: boolean }) => {
    setCursor(path);
    if (event.shiftKey && cursor) {
      const from = rows.findIndex((row) => row.entry.path === cursor);
      const to = rows.findIndex((row) => row.entry.path === path);
      const [start, end] = from < to ? [from, to] : [to, from];
      setSelection(rows.slice(start, end + 1).map((row) => row.entry.path));
    } else if (event.ctrlKey) {
      setSelection((current) => (current.includes(path) ? current.filter((item) => item !== path) : [...current, path]));
    } else {
      setSelection([path]);
    }
  };

  /** Ouvre dans l'éditeur de Clide ; un binaire y part seul vers l'application par défaut. */
  const openFile = (entry: DirectoryEntry) => {
    void openInEditor(entry.path);
  };
  const openWithDefaultApp = (entry: DirectoryEntry) => {
    post("/api/files/open", { root, path: entry.path, reveal: false }).catch(report);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (editing) return;
    const index = rows.findIndex((row) => row.entry.path === cursor);
    const current = rows[index]?.entry;
    const chosen = selection.length > 0 ? selection : current ? [current.path] : [];
    const key = event.key;
    const mod = event.ctrlKey || event.metaKey;
    const handled = () => event.preventDefault();

    if (key === "ArrowDown" || key === "ArrowUp") {
      handled();
      const next = rows[Math.min(Math.max(index + (key === "ArrowDown" ? 1 : -1), 0), rows.length - 1)];
      if (next) selectRow(next.entry.path, { ctrlKey: false, shiftKey: event.shiftKey });
    } else if (key === "ArrowRight" && current?.directory) {
      handled();
      toggle(current, true);
    } else if (key === "ArrowLeft" && current) {
      handled();
      if (current.directory && expanded.has(current.relativePath)) toggle(current, false);
      else {
        const parent = rows.find((row) => row.entry.path === parentPath(current.path));
        if (parent) selectRow(parent.entry.path, { ctrlKey: false, shiftKey: false });
      }
    } else if (key === "Enter" && current) {
      handled();
      if (current.directory) toggle(current);
      else openFile(current);
    } else if (key === " " && current && !current.directory) {
      handled();
      setPreviewing(current.path);
    } else if (key === "F2" && current) {
      handled();
      setEditing({ kind: "rename", path: current.path });
    } else if (key === "Delete") {
      handled();
      void trash(chosen);
    } else if (mod && (key === "c" || key === "C") && chosen.length > 0) {
      handled();
      clipboard = { mode: "copy", paths: chosen };
    } else if (mod && (key === "x" || key === "X") && chosen.length > 0) {
      handled();
      clipboard = { mode: "cut", paths: chosen };
    } else if (mod && (key === "v" || key === "V")) {
      handled();
      paste();
    } else if (mod && (key === "z" || key === "Z")) {
      handled();
      void undo();
    }
  };

  const submitEdit = async (value: string) => {
    const current = editing;
    setEditing(undefined);
    if (!current || !value.trim()) return;
    try {
      if (current.kind === "rename") {
        if (value.trim() === baseName(current.path)) return;
        const renamed = await fs.rename(current.path, value);
        followRename(current.path, renamed);
        remember({ kind: "rename", from: current.path, to: renamed });
        refresh([renamed]);
        setSelection([renamed]);
        setCursor(renamed);
      } else {
        const created = await fs.create(current.parent, value, current.type);
        remember({ kind: "create", path: created });
        refresh([created]);
        setSelection([created]);
        setCursor(created);
      }
    } catch (error) {
      report(error);
    }
    requestAnimationFrame(() => list.current?.focus());
  };

  const startCreate = (type: "file" | "dir") => {
    const parent = targetDir();
    if (parent !== root) toggle({ relativePath: relativeOf(parent) } as DirectoryEntry, true);
    setEditing({ kind: "create", parent, type });
  };

  /** Chemins d'un dépôt : ceux de l'explorateur, ou des fichiers venus de Windows dans l'application de bureau. */
  const droppedPaths = (event: DragEvent): { paths: string[]; internal: boolean } => {
    const internal = event.dataTransfer.getData(PATHS_MIME);
    if (internal) return { paths: JSON.parse(internal) as string[], internal: true };
    const desktop = window.clide;
    const files = [...event.dataTransfer.files];
    const paths = desktop?.pathForFile ? files.map((file) => desktop.pathForFile?.(file) ?? "").filter(Boolean) : [];
    return { paths, internal: false };
  };

  const onDrop = (event: DragEvent, dir: string) => {
    event.preventDefault();
    event.stopPropagation();
    setDropTarget(undefined);
    const { paths, internal } = droppedPaths(event);
    if (paths.length === 0) return;
    // Dans l'arbre, un glisser déplace, Ctrl enfoncé il copie ; venu de Windows, il copie toujours.
    void runTransfer(internal && !event.ctrlKey ? "move" : "copy", paths, dir);
  };

  const itemsFor = (entry: DirectoryEntry): MenuItem[] => {
    const chosen = selection.includes(entry.path) ? selection : [entry.path];
    return [
      ...(entry.directory
        ? ([
            { kind: "item", label: t("Nouveau fichier"), icon: FilePlus, run: () => { setCursor(entry.path); startCreateIn(entry.path, "file"); } },
            { kind: "item", label: t("Nouveau dossier"), icon: FolderPlus, run: () => { setCursor(entry.path); startCreateIn(entry.path, "dir"); } },
            { kind: "separator" },
          ] as MenuItem[])
        : ([
            { kind: "item", label: t("Ouvrir"), run: () => openFile(entry) },
            { kind: "item", label: t("Aperçu (Espace)"), icon: Eye, run: () => setPreviewing(entry.path) },
            { kind: "separator" },
          ] as MenuItem[])),
      { kind: "item", label: t("Couper"), icon: Scissors, shortcut: "Ctrl+X", run: () => (clipboard = { mode: "cut", paths: chosen }) },
      { kind: "item", label: t("Copier"), icon: Copy, shortcut: "Ctrl+C", run: () => (clipboard = { mode: "copy", paths: chosen }) },
      {
        kind: "item",
        label: t("Coller"),
        icon: ClipboardPaste,
        shortcut: "Ctrl+V",
        disabled: !clipboard,
        run: () => {
          setCursor(entry.path);
          if (!clipboard) return;
          const { mode, paths } = clipboard;
          if (mode === "cut") clipboard = undefined;
          void runTransfer(mode === "cut" ? "move" : "copy", paths, entry.directory ? entry.path : parentPath(entry.path));
        },
      },
      { kind: "item", label: t("Dupliquer"), run: () => void runTransfer("copy", chosen, parentPath(entry.path), "keepBoth") },
      { kind: "item", label: t("Renommer"), shortcut: "F2", run: () => setEditing({ kind: "rename", path: entry.path }) },
      { kind: "item", label: t("Mettre à la corbeille"), icon: Trash2, shortcut: "Suppr", danger: true, run: () => void trash(chosen) },
      { kind: "separator" },
      { kind: "item", label: t("Insérer le chemin"), run: () => typeIntoActive(`${quotePath(entry.path)} `) },
      { kind: "item", label: t("Copier le chemin"), run: () => void navigator.clipboard.writeText(entry.path) },
      { kind: "item", label: t("Ouvrir avec l'application par défaut"), run: () => openWithDefaultApp(entry) },
      { kind: "item", label: t("Afficher dans l'Explorateur"), run: () => void post("/api/files/open", { root, path: entry.path, reveal: true }).catch(report) },
      ...(entry.directory
        ? ([
            { kind: "separator" },
            { kind: "item", label: t("Claude ici"), run: () => openTerminal("claude", { command: "claude", cwd: entry.path }) },
            { kind: "item", label: t("Shell ici"), run: () => openTerminal("shell", { cwd: entry.path }) },
            { kind: "item", label: t("Ouvrir comme projet"), run: () => openProject(entry.path) },
          ] as MenuItem[])
        : []),
    ];
  };

  const startCreateIn = (parent: string, type: "file" | "dir") => {
    if (parent !== root) toggle({ relativePath: relativeOf(parent) } as DirectoryEntry, true);
    setEditing({ kind: "create", parent, type });
  };

  const creatingIn = editing?.kind === "create" ? editing.parent : undefined;
  const editRow = (depth: number) =>
    editing?.kind === "create" ? (
      <li className="flex items-center gap-1.5 py-0.5 pr-2" style={{ paddingLeft: 8 + depth * 12 + 16 }}>
        <FileIcon name="" directory={editing.type === "dir"} />
        <NameInput initial="" onSubmit={(value) => void submitEdit(value)} onCancel={() => setEditing(undefined)} />
      </li>
    ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-0.5 border-b px-2 py-1 text-[12px]">
        <span className="min-w-0 flex-1 truncate px-1 font-medium" title={root}>
          {project.name}
        </span>
        <Button variant="ghost" size="icon" className="size-6" title={t("Nouveau fichier")} onClick={() => startCreate("file")}>
          <FilePlus className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="size-6" title={t("Nouveau dossier")} onClick={() => startCreate("dir")}>
          <FolderPlus className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          title={t("Recharger")}
          onClick={() => {
            void load("");
            for (const path of expanded) void load(path);
          }}
        >
          <RefreshCw className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="size-6" title={t("Tout replier")} onClick={() => setExpanded(new Set())}>
          <ListCollapse className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn("size-6", showHidden && "text-primary")}
          onClick={() => setState({ showHidden: !showHidden })}
          title={showHidden ? t("Masquer les fichiers cachés et ignorés") : t("Afficher les fichiers cachés (.env, .claude…) et ceux que git ignore")}
        >
          {showHidden ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
        </Button>
      </div>

      {failure && (
        <button
          type="button"
          className="shrink-0 border-b bg-destructive/10 px-3 py-1 text-left text-[11px] text-destructive"
          title={t("Masquer")}
          onClick={() => setFailure(undefined)}
        >
          {failure}
        </button>
      )}

      <ScrollArea className="min-h-0 flex-1">
        <ul
          ref={list}
          // Focalisable pour recevoir le clavier : les touches n'agissent que si
          // l'arbre a le focus, jamais quand elles partent au terminal.
          tabIndex={0}
          data-explorer
          onKeyDown={onKeyDown}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = event.ctrlKey || event.dataTransfer.types.includes("Files") ? "copy" : "move";
          }}
          onDrop={(event) => onDrop(event, root)}
          className="m-0 min-h-full list-none py-1 outline-none"
        >
          {creatingIn === root && editRow(0)}
          {rows.map(({ entry, depth }) => {
            const open = entry.directory && expanded.has(entry.relativePath);
            const selected = selection.includes(entry.path);
            const renaming = editing?.kind === "rename" && editing.path === entry.path;
            return (
              <li key={entry.path} className="contents">
                <ContextArea items={() => itemsFor(entry)}>
                  <div
                    title={entry.path}
                    draggable={!renaming}
                    onDragStart={(event) => {
                      const paths = selected ? selection : [entry.path];
                      event.dataTransfer.setData(PATHS_MIME, JSON.stringify(paths));
                      event.dataTransfer.setData("text/plain", paths.join(" "));
                      event.dataTransfer.effectAllowed = "copyMove";
                    }}
                    onDragOver={(event) => {
                      if (!entry.directory) return;
                      event.preventDefault();
                      event.stopPropagation();
                      setDropTarget(entry.path);
                    }}
                    onDragLeave={() => setDropTarget((current) => (current === entry.path ? undefined : current))}
                    onDrop={(event) => (entry.directory ? onDrop(event, entry.path) : undefined)}
                    onClick={(event) => {
                      selectRow(entry.path, event);
                      if (entry.directory && !event.ctrlKey && !event.shiftKey) toggle(entry);
                    }}
                    onDoubleClick={() => {
                      if (!entry.directory) openFile(entry);
                    }}
                    onContextMenu={() => {
                      if (!selected) setSelection([entry.path]);
                      setCursor(entry.path);
                    }}
                    className={cn(
                      "flex cursor-pointer items-center gap-1.5 py-0.5 pr-2 hover:bg-accent",
                      selected && "bg-accent",
                      dropTarget === entry.path && "outline outline-1 outline-primary",
                    )}
                    style={{ paddingLeft: 8 + depth * 12 }}
                  >
                    {entry.directory ? (
                      open ? (
                        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                      )
                    ) : (
                      <span className="w-3.5 shrink-0" />
                    )}
                    <FileIcon name={entry.name} directory={entry.directory} open={open} />
                    {renaming ? (
                      <NameInput initial={entry.name} onSubmit={(value) => void submitEdit(value)} onCancel={() => setEditing(undefined)} />
                    ) : (
                      <span className={cn("truncate", (entry.name.startsWith(".") || entry.ignored) && "opacity-60", entry.ignored && "italic")} title={entry.ignored ? t("Ignoré par git (.gitignore)") : undefined}>
                        {entry.name}
                      </span>
                    )}
                    {entry.hasSessions && (
                      <span className="shrink-0 text-[10px] text-primary" title={t("Des sessions Claude ont été lancées dans ce dossier")}>
                        ✳
                      </span>
                    )}
                  </div>
                </ContextArea>
                {open && creatingIn === entry.path && editRow(depth + 1)}
              </li>
            );
          })}
        </ul>
      </ScrollArea>

      <FilePreviewDialog root={root} path={previewing} onClose={() => setPreviewing(undefined)} />
      <ConflictDialog
        pending={pending}
        onChoose={(choice) => {
          const current = pending;
          setPending(undefined);
          if (current && choice) void runTransfer(current.mode, current.sources, current.targetDir, choice);
        }}
      />
    </div>
  );
}

/** Des noms sont pris dans la cible : remplacer (l'existant part à la corbeille), garder les deux, ou renoncer. */
function ConflictDialog({ pending, onChoose }: { pending: Pending | undefined; onChoose: (choice: OnConflict | undefined) => void }) {
  return (
    <Dialog open={!!pending} onOpenChange={(open) => !open && onChoose(undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Des noms sont déjà pris")}</DialogTitle>
          <DialogDescription>
            {t("{names} existe déjà dans {folder}.", {
              names: pending?.conflicts.join(", ") ?? "",
              folder: pending ? baseName(pending.targetDir) : "",
            })}
          </DialogDescription>
        </DialogHeader>
        <p className="text-[12px] text-muted-foreground">
          {t("Remplacer envoie l'existant à la corbeille ; garder les deux nomme la copie « nom (2) ».")}
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onChoose(undefined)}>
            {t("Annuler")}
          </Button>
          <Button variant="outline" onClick={() => onChoose("keepBoth")}>
            {t("Garder les deux")}
          </Button>
          <Button onClick={() => onChoose("replace")}>{t("Remplacer")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
