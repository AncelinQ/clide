import { FileText, Link2, NotebookPen, Pencil, Pin, Plus, X } from "lucide-react";
import { useId, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";

import { Async, DangerButton, Empty, FoldSection, NameInput, useAsync } from "@/components/common";
import { ContextArea, MenuButton } from "@/components/Menu";
import { ReorderItem, useReorder, type ReorderList } from "@/components/Reorderable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { PATHS_MIME, pickPath } from "@/lib/api";
import type { MenuItem } from "@/lib/menu";
import { fileName, matchesFilter, shortUrl, underRoot } from "@/lib/memo";
import { dropTab } from "@/lib/tab-order";
import type { MemoLink, ProjectMemo } from "@/lib/types";
import { followRename, openFile } from "@/state/editor";
import {
  createNote,
  loadMemo,
  openLink,
  orderLinks,
  orderPins,
  pinFiles,
  putLink,
  removeLink,
  renameNote,
  trashNote,
  unpinFile,
  useMemoVersion,
} from "@/state/memo";
import { cn } from "cn";

/** Les erreurs du serveur arrivent en français : traduites quand la table les connaît. */
const messageOf = (error: unknown): string => t((error as Error).message);

/**
 * Le Mémo d'un projet : ses liens, ses notes et les fichiers qu'on y épingle,
 * gardés dans le dossier de données de Clide, jamais dans le projet.
 */
export function MemoPanel({ root }: { root: string }) {
  const version = useMemoVersion();
  const state = useAsync(() => loadMemo(root), [root], version);
  return <Async state={state}>{(memo) => <MemoBody root={root} memo={memo} />}</Async>;
}

/**
 * Les chemins d'un glisser : ceux de l'explorateur de Clide, ou des fichiers de
 * l'Explorateur Windows, que seule l'application de bureau sait nommer.
 */
function droppedPaths(data: DataTransfer): string[] {
  const inner = data.getData(PATHS_MIME);
  if (inner) {
    try {
      const parsed: unknown = JSON.parse(inner);
      return Array.isArray(parsed) ? parsed.filter((path): path is string => typeof path === "string") : [];
    } catch {
      return [];
    }
  }
  return [...data.files].map((file) => window.clide?.pathForFile(file)).filter((path): path is string => Boolean(path));
}

function MemoBody({ root, memo }: { root: string; memo: ProjectMemo }) {
  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState<"link" | "note">();
  const [notice, setNotice] = useState<string>();
  const report = (error: unknown) => setNotice(messageOf(error));
  const attempt = (action: () => Promise<unknown>) => {
    setNotice(undefined);
    void action().catch(report);
  };

  const filtering = filter.trim() !== "";
  const links = memo.links.filter((link) => matchesFilter(`${link.name} ${link.url}`, filter));
  const notes = memo.notes.filter((note) => matchesFilter(note.name, filter));
  const pins = memo.pins.filter((pin) => matchesFilter(underRoot(pin.path, root), filter));
  const empty = memo.links.length + memo.notes.length + memo.pins.length === 0;

  // Un lien glissé depuis le navigateur, ou des fichiers depuis l'Explorateur.
  const onDragOver = (event: DragEvent) => {
    const types = event.dataTransfer.types;
    if (!types.includes("text/uri-list") && !types.includes(PATHS_MIME) && !types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };
  const onDrop = (event: DragEvent) => {
    const paths = droppedPaths(event.dataTransfer);
    if (paths.length > 0) {
      event.preventDefault();
      attempt(() => pinFiles(root, paths));
      return;
    }
    const url = event.dataTransfer
      .getData("text/uri-list")
      .split(/\r?\n/)
      .find((line) => line && !line.startsWith("#"));
    if (!url) return;
    event.preventDefault();
    attempt(() => putLink(root, { name: "", url }));
  };

  const pick = async () => {
    const path = await pickPath({ kind: "file", title: t("Épingler un fichier"), start: root });
    if (path) await pinFiles(root, [path]);
  };
  const addItems: MenuItem[] = [
    { kind: "item", label: t("Ajouter un lien"), icon: Link2, run: () => setAdding("link") },
    { kind: "item", label: t("Nouvelle note"), icon: FileText, run: () => setAdding("note") },
    { kind: "item", label: t("Épingler un fichier…"), icon: Pin, run: () => attempt(pick) },
  ];

  return (
    <div className="grid min-h-40 grid-cols-1 gap-2" onDragOver={onDragOver} onDrop={onDrop}>
      <div className="flex items-center gap-1">
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t("Filtrer…")}
          aria-label={t("Filtrer le mémo")}
          className="h-7 text-[12px]"
        />
        <MenuButton
          trigger={
            <Button variant="ghost" size="icon" className="size-7 shrink-0" aria-label={t("Ajouter au mémo")} title={t("Ajouter au mémo")}>
              <Plus className="size-4" aria-hidden />
            </Button>
          }
          items={addItems}
        />
      </div>

      {notice && (
        <p role="alert" className="m-0 text-[12px] text-destructive">
          {notice}
        </p>
      )}
      {adding === "link" && <LinkForm onSubmit={(link) => putLink(root, link)} onDone={() => setAdding(undefined)} />}
      {adding === "note" && (
        <label className="grid gap-1 text-[11px] text-muted-foreground">
          {t("Nom de la nouvelle note")}
          <NameInput
            initial=""
            whole
            onSubmit={(name) => {
              setAdding(undefined);
              if (name.trim()) attempt(async () => openFile(await createNote(root, name)));
            }}
            onCancel={() => setAdding(undefined)}
          />
        </label>
      )}

      {empty && !adding && (
        <Empty icon={NotebookPen}>
          {t(
            "Les liens d'un projet (docs, tickets, maquettes), tes notes à son sujet, gardées hors du dépôt, et les fichiers que tu ouvres souvent. Ajoute-les avec +, ou glisse ici un lien depuis le navigateur.",
          )}
        </Empty>
      )}

      {memo.links.length > 0 && (
        <FoldSection id="memo:links" title={t("Liens")} count={memo.links.length} forceOpen={filtering}>
          <LinkList root={root} links={links} filtering={filtering} onError={report} />
        </FoldSection>
      )}
      {memo.notes.length > 0 && (
        <FoldSection id="memo:notes" title={t("Notes")} count={memo.notes.length} forceOpen={filtering}>
          <NoteList root={root} notes={notes} onError={report} />
        </FoldSection>
      )}
      {memo.pins.length > 0 && (
        <FoldSection id="memo:pins" title={t("Fichiers épinglés")} count={memo.pins.length} forceOpen={filtering}>
          <PinList root={root} pins={pins} filtering={filtering} onError={report} />
        </FoldSection>
      )}
      {filtering && links.length + notes.length + pins.length === 0 && !empty && (
        <p className="m-0 text-[12px] text-muted-foreground">{t("Rien ne correspond au filtre.")}</p>
      )}
    </div>
  );
}

/**
 * Une ligne du mémo : un bouton qui couvre la ligne entière, et ses actions,
 * révélées au survol comme au clavier, qui restent au-dessus de lui.
 */
function Line({
  icon,
  title,
  sub,
  hint,
  dim = false,
  onOpen,
  onDoubleClick,
  menu,
  actions,
}: {
  icon: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  hint: string;
  dim?: boolean;
  onOpen?: () => void;
  onDoubleClick?: () => void;
  menu: () => MenuItem[];
  actions: ReactNode;
}) {
  return (
    <div role="listitem" className="group relative flex items-center gap-1 rounded px-1 py-1 hover:bg-accent">
      <ContextArea items={menu}>
        <button
          type="button"
          className={cn("flex min-w-0 flex-1 items-center gap-1.5 text-left after:absolute after:inset-0", dim && "text-muted-foreground")}
          title={hint}
          onClick={onOpen}
          onDoubleClick={onDoubleClick}
          aria-disabled={onOpen ? undefined : true}
        >
          {icon}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px]">{title}</span>
            {sub && <span className="block truncate text-[11px] text-muted-foreground">{sub}</span>}
          </span>
        </button>
      </ContextArea>
      <span className="relative -my-1 hidden shrink-0 group-focus-within:flex group-hover:flex has-[[data-armed]]:flex">{actions}</span>
    </div>
  );
}

/** Un bouton d'action d'une ligne, une icône et son nom. */
function LineAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Button variant="ghost" size="icon" className="size-6" aria-label={label} title={label} onClick={onClick}>
      {children}
    </Button>
  );
}

/**
 * Monter et descendre, au menu d'une ligne : l'équivalent au clavier du glisser.
 * Rien pendant un filtre, qui cache les voisines.
 */
function moveItems(keys: readonly string[], key: string, filtering: boolean, order: (keys: string[]) => void): MenuItem[] {
  if (filtering) return [];
  const index = keys.indexOf(key);
  const above = keys[index - 1];
  const below = keys[index + 1];
  return [
    { kind: "item", label: t("Monter"), disabled: !above, run: () => above && order(dropTab(keys, key, above, "before")) },
    { kind: "item", label: t("Descendre"), disabled: !below, run: () => below && order(dropTab(keys, key, below, "after")) },
    { kind: "separator" },
  ];
}

/** Une liste qu'on range au glisser : l'aperçu suit le pointeur, l'ordre s'enregistre au lâcher. */
function useOrderedList(group: string, keys: readonly string[], order: (keys: string[]) => void): { shown: string[]; list: ReorderList } {
  const reorder = useReorder(group, (moved, target, side) => order(dropTab(keys, moved, target, side)), "y");
  const aim = reorder.drag?.aim;
  const shown = reorder.drag && aim ? dropTab(keys, reorder.drag.id, aim.target, aim.side) : [...keys];
  return { shown, list: reorder.bind(shown) };
}

function LinkList({ root, links, filtering, onError }: { root: string; links: MemoLink[]; filtering: boolean; onError: (error: unknown) => void }) {
  const [editing, setEditing] = useState<string>();
  const urls = links.map((link) => link.url);
  const order = (next: string[]) => void orderLinks(root, next).catch(onError);
  const { shown, list } = useOrderedList("memo-links", urls, order);
  const byUrl = new Map(links.map((link) => [link.url, link]));
  const remove = (url: string) => void removeLink(root, url).catch(onError);

  return (
    <div role="list" {...list.zone} className="grid grid-cols-1 gap-0.5 py-1">
      {shown.map((url) => {
        const link = byUrl.get(url);
        if (!link) return null;
        if (editing === url) {
          return <LinkForm key={url} initial={link} onSubmit={(next) => putLink(root, next, url)} onDone={() => setEditing(undefined)} />;
        }
        return (
          <ReorderItem key={url} list={list} id={url} fixed={filtering}>
            <Line
              icon={<Link2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
              title={link.name}
              sub={shortUrl(link.url)}
              hint={link.url}
              onOpen={() => openLink(link.url)}
              menu={() => [
                { kind: "item", label: t("Ouvrir"), run: () => openLink(link.url) },
                { kind: "item", label: t("Copier l'adresse"), run: () => void navigator.clipboard.writeText(link.url) },
                { kind: "item", label: t("Modifier…"), run: () => setEditing(url) },
                { kind: "separator" },
                ...moveItems(urls, url, filtering, order),
                { kind: "item", label: t("Retirer du mémo"), danger: true, run: () => remove(url) },
              ]}
              actions={
                <>
                  <LineAction label={t("Modifier le lien")} onClick={() => setEditing(url)}>
                    <Pencil className="size-3.5" aria-hidden />
                  </LineAction>
                  <LineAction label={t("Retirer le lien")} onClick={() => remove(url)}>
                    <X className="size-3.5" aria-hidden />
                  </LineAction>
                </>
              }
            />
          </ReorderItem>
        );
      })}
    </div>
  );
}

/** Adresse et nom d'un lien : Entrée enregistre, Échap annule. Sans nom, le lien prend celui de son hôte. */
function LinkForm({ initial, onSubmit, onDone }: { initial?: MemoLink; onSubmit: (link: MemoLink) => Promise<unknown>; onDone: () => void }) {
  const [url, setUrl] = useState(initial?.url ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const errorId = useId();

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await onSubmit({ name, url });
      onDone();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  };
  const keys = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === "Enter") void submit();
    else if (event.key === "Escape") onDone();
  };

  return (
    <div className="grid gap-1.5 rounded border p-2" data-memo-form>
      <label className="grid gap-0.5 text-[11px] text-muted-foreground">
        {t("Adresse")}
        <Input
          autoFocus={!initial}
          value={url}
          spellCheck={false}
          placeholder="https://…"
          onChange={(event) => {
            setUrl(event.target.value);
            setError(undefined);
          }}
          onKeyDown={keys}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="h-7 text-[12px]"
        />
      </label>
      <label className="grid gap-0.5 text-[11px] text-muted-foreground">
        {t("Nom (facultatif)")}
        <Input autoFocus={Boolean(initial)} value={name} onChange={(event) => setName(event.target.value)} onKeyDown={keys} className="h-7 text-[12px]" />
      </label>
      {error && (
        <p id={errorId} role="alert" className="m-0 text-[11px] text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-1.5">
        <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={onDone}>
          {t("Annuler")}
        </Button>
        <Button size="sm" className="h-6 px-2 text-[11px]" disabled={busy || !url.trim()} onClick={() => void submit()}>
          {initial ? t("Enregistrer") : t("Ajouter")}
        </Button>
      </div>
    </div>
  );
}

function NoteList({ root, notes, onError }: { root: string; notes: ProjectMemo["notes"]; onError: (error: unknown) => void }) {
  const [renaming, setRenaming] = useState<string>();
  const trash = (path: string) => trashNote(root, path);

  return (
    <div role="list" className="grid grid-cols-1 gap-0.5 py-1">
      {notes.map((note) =>
        renaming === note.path ? (
          <label role="listitem" key={note.path} className="flex px-1 py-1">
            <span className="sr-only">{t("Nouveau nom de la note")}</span>
            <NameInput
              initial={note.name}
              whole
              onSubmit={(name) => {
                setRenaming(undefined);
                if (!name.trim() || name === note.name) return;
                // Ouverte dans l'éditeur, la note y suit son nouveau nom.
                void renameNote(root, note.path, name)
                  .then((renamed) => followRename(note.path, renamed))
                  .catch(onError);
              }}
              onCancel={() => setRenaming(undefined)}
            />
          </label>
        ) : (
          <Line
            key={note.path}
            icon={<FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
            title={note.name}
            hint={t("Ouvrir dans l'éditeur ; double-clic pour renommer")}
            onOpen={() => void openFile(note.path)}
            onDoubleClick={() => setRenaming(note.path)}
            menu={() => [
              { kind: "item", label: t("Ouvrir"), run: () => void openFile(note.path) },
              { kind: "item", label: t("Renommer"), run: () => setRenaming(note.path) },
              { kind: "separator" },
              { kind: "item", label: t("Mettre à la corbeille"), danger: true, run: () => void trash(note.path).catch(onError) },
            ]}
            actions={
              <>
                <LineAction label={t("Renommer la note")} onClick={() => setRenaming(note.path)}>
                  <Pencil className="size-3.5" aria-hidden />
                </LineAction>
                <DangerButton label={t("corbeille")} onConfirm={() => trash(note.path)} />
              </>
            }
          />
        ),
      )}
    </div>
  );
}

function PinList({ root, pins, filtering, onError }: { root: string; pins: ProjectMemo["pins"]; filtering: boolean; onError: (error: unknown) => void }) {
  const paths = pins.map((pin) => pin.path);
  const order = (next: string[]) => void orderPins(root, next).catch(onError);
  const { shown, list } = useOrderedList("memo-pins", paths, order);
  const byPath = new Map(pins.map((pin) => [pin.path, pin]));
  const remove = (path: string) => void unpinFile(root, path).catch(onError);

  return (
    <div role="list" {...list.zone} className="grid grid-cols-1 gap-0.5 py-1">
      {shown.map((path) => {
        const pin = byPath.get(path);
        if (!pin) return null;
        const where = underRoot(path, root);
        return (
          <ReorderItem key={path} list={list} id={path} fixed={filtering}>
            <Line
              icon={<Pin className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
              title={
                <>
                  {fileName(path)}
                  {!pin.exists && <span className="ml-1.5 text-[10px] text-muted-foreground">{t("introuvable")}</span>}
                </>
              }
              sub={where !== fileName(path) ? where : undefined}
              hint={path}
              dim={!pin.exists}
              {...(pin.exists ? { onOpen: () => void openFile(path) } : {})}
              menu={() => [
                { kind: "item", label: t("Ouvrir"), disabled: !pin.exists, run: () => void openFile(path) },
                { kind: "item", label: t("Copier le chemin"), run: () => void navigator.clipboard.writeText(path) },
                { kind: "separator" },
                ...moveItems(paths, path, filtering, order),
                { kind: "item", label: t("Retirer du mémo"), run: () => remove(path) },
              ]}
              actions={
                <LineAction label={t("Retirer du mémo")} onClick={() => remove(path)}>
                  <X className="size-3.5" aria-hidden />
                </LineAction>
              }
            />
          </ReorderItem>
        );
      })}
    </div>
  );
}
