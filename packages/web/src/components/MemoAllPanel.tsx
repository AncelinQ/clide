import { FileText, Link2, NotebookPen, Pin } from "lucide-react";
import type { ReactNode } from "react";

import { Async, Empty, FoldSection, useAsync } from "@/components/common";
import { t } from "@/i18n";
import { fileName, matchesFilter, shortUrl, underRoot } from "@/lib/memo";
import type { ProjectMemo } from "@/lib/types";
import { openFile } from "@/state/editor";
import { loadAllMemos, openLink, useMemoVersion } from "@/state/memo";
import { useStore } from "@/state/store";
import { cn } from "cn";

/**
 * Les mémos de tous les projets, ouverts ou non, en lecture seule : un lien, une
 * note ou un fichier se retrouve sans aller dans le projet. On les modifie dans
 * le mode Mémo de chaque projet.
 */
export function MemoAllPanel({ filter }: { filter: string }) {
  const version = useMemoVersion();
  const state = useAsync(() => loadAllMemos(), [], version);
  const open = useStore((current) => current.projects).map((project) => project.root.toLowerCase());
  return (
    <Async state={state}>
      {(memos) =>
        memos.length === 0 ? (
          <Empty icon={NotebookPen}>{t("Aucun mémo pour l'instant : chaque projet a le sien, dans son mode Mémo.")}</Empty>
        ) : (
          <MemoGroups memos={memos} filter={filter} open={open} />
        )
      }
    </Async>
  );
}

function MemoGroups({ memos, filter, open }: { memos: ProjectMemo[]; filter: string; open: string[] }) {
  const filtering = filter.trim() !== "";
  const groups = memos
    .map((memo) => {
      const project = fileName(memo.root);
      return {
        memo,
        project,
        links: memo.links.filter((link) => matchesFilter(`${project} ${link.name} ${link.url}`, filter)),
        notes: memo.notes.filter((note) => matchesFilter(`${project} ${note.name}`, filter)),
        pins: memo.pins.filter((pin) => matchesFilter(`${project} ${underRoot(pin.path, memo.root)}`, filter)),
      };
    })
    .filter((group) => group.links.length + group.notes.length + group.pins.length > 0);

  if (groups.length === 0) return <p className="py-3 text-[12px] text-muted-foreground">{t("Rien ne correspond au filtre.")}</p>;
  return (
    <div className="-mt-3">
      {groups.map(({ memo, project, links, notes, pins }) => {
        // Un fichier épinglé ne s'ouvre que dans un projet ouvert : l'éditeur refuserait le reste.
        const reachable = open.includes(memo.root.toLowerCase());
        return (
          <FoldSection
            key={memo.root}
            id={`memo-all:${memo.root}`}
            title={<span title={memo.root}>{project}</span>}
            count={links.length + notes.length + pins.length}
            forceOpen={filtering}
          >
            <div role="list" className="grid grid-cols-1 gap-0.5 py-1">
              {links.map((link) => (
                <Item
                  key={link.url}
                  icon={<Link2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                  title={link.name}
                  sub={shortUrl(link.url)}
                  hint={link.url}
                  onOpen={() => openLink(link.url)}
                />
              ))}
              {notes.map((note) => (
                <Item
                  key={note.path}
                  icon={<FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                  title={note.name}
                  hint={t("Ouvrir dans l'éditeur")}
                  onOpen={() => void openFile(note.path)}
                />
              ))}
              {pins.map((pin) => {
                const where = underRoot(pin.path, memo.root);
                const usable = pin.exists && reachable;
                return (
                  <Item
                    key={pin.path}
                    icon={<Pin className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                    title={
                      <>
                        {fileName(pin.path)}
                        {!pin.exists && <span className="ml-1.5 text-[10px] text-muted-foreground">{t("introuvable")}</span>}
                      </>
                    }
                    sub={where !== fileName(pin.path) ? where : undefined}
                    hint={reachable ? pin.path : t("Projet fermé : ouvre-le pour ouvrir ce fichier")}
                    {...(usable ? { onOpen: () => void openFile(pin.path) } : {})}
                  />
                );
              })}
            </div>
          </FoldSection>
        );
      })}
    </div>
  );
}

/** Une entrée d'un mémo : un bouton qui l'ouvre, grisé quand elle ne s'ouvre pas d'ici. */
function Item({ icon, title, sub, hint, onOpen }: { icon: ReactNode; title: ReactNode; sub?: ReactNode; hint: string; onOpen?: () => void }) {
  return (
    <div role="listitem">
      <button
        type="button"
        className={cn(
          "flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-1 text-left",
          onOpen ? "hover:bg-accent" : "cursor-default text-muted-foreground",
        )}
        title={hint}
        onClick={onOpen}
        aria-disabled={onOpen ? undefined : true}
      >
        {icon}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px]">{title}</span>
          {sub && <span className="block truncate text-[11px] text-muted-foreground">{sub}</span>}
        </span>
      </button>
    </div>
  );
}
