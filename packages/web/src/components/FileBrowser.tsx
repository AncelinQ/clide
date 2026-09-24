import { ArrowUp, File, Folder } from "lucide-react";
import { useState } from "react";

import { Async, useAsync } from "@/components/common";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { t } from "@/i18n";
import { PATHS_MIME, api, post, quotePath } from "@/lib/api";
import type { DirectoryListing } from "@/lib/types";
import { getState, openProject, updateProject, type Project } from "@/state/store";
import { openTerminal, typeInto } from "@/state/terminals";
import { FilePreviewDialog } from "@/components/FilePreview";
import { cn } from "cn";

/** Dossier parent d'un chemin relatif. La racine est sa propre limite. */
function parentOf(relativePath: string): string {
  const segments = relativePath.split(/[\\/]/).filter(Boolean);
  segments.pop();
  return segments.join("\\");
}

/** Écrit un chemin dans le terminal actif, entre guillemets s'il porte des espaces. */
function insertPath(path: string): void {
  const { activeTerminalId } = getState();
  if (!activeTerminalId) return;
  typeInto(activeTerminalId, `${quotePath(path)} `);
}

/**
 * Ouvre avec l'application par défaut, ou montre dans l'Explorateur.
 *
 * Le serveur montre au lieu d'ouvrir ce que Windows exécuterait : l'échec d'un
 * geste aussi anodin qu'un double-clic ne vaut pas une alerte, il part en console.
 */
function openOnDisk(root: string, path: string, reveal = false): void {
  post("/api/files/open", { root, path, reveal }).catch((error: unknown) => {
    console.error("[clide] ouverture impossible", path, error);
  });
}

export function FileBrowser({ project }: { project: Project }) {
  // Clic simple : sélection. Le double-clic ouvre ; insérer le chemin à chaque
  // clic l'écrirait deux fois avant l'ouverture.
  const [selected, setSelected] = useState<string>();
  const [previewing, setPreviewing] = useState<string>();
  const state = useAsync(
    () => api<DirectoryListing>("/api/files", { root: project.root, path: project.browsePath }),
    [project.root, project.browsePath],
  );

  const goTo = (relativePath: string) => updateProject(project.root, { browsePath: relativePath });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-0.5 border-b px-2 py-1.5 text-[12px] text-muted-foreground">
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          disabled={!project.browsePath}
          onClick={() => goTo(parentOf(project.browsePath))}
          title={t("Dossier parent")}
        >
          <ArrowUp className="size-3.5" />
        </Button>
        <Async state={state}>
          {(listing) =>
            listing.breadcrumb.map((segment, index) => (
              <span key={segment.relativePath} className="flex items-center">
                {index > 0 && <span className="px-0.5 opacity-40">›</span>}
                <button
                  type="button"
                  onClick={() => goTo(segment.relativePath)}
                  className={
                    index === listing.breadcrumb.length - 1
                      ? "rounded px-1 text-foreground"
                      : "rounded px-1 hover:bg-accent hover:text-foreground"
                  }
                >
                  {segment.name}
                </button>
              </span>
            ))
          }
        </Async>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <Async state={state}>
          {(listing) => (
            <ul
              // Focalisable pour recevoir Espace : la touche n'agit que si la liste
              // a le focus, jamais quand elle part au terminal.
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key !== " " || !selected) return;
                event.preventDefault();
                setPreviewing(selected);
              }}
              className="m-0 list-none py-1 outline-none"
            >
              {listing.relativePath && (
                <li
                  onClick={() => goTo(parentOf(project.browsePath))}
                  className="flex cursor-pointer items-center gap-2 px-3 py-1 text-muted-foreground hover:bg-accent"
                >
                  <ArrowUp className="size-3.5 shrink-0" />
                  <span>..</span>
                </li>
              )}
              {listing.entries.map((entry) => (
                <ContextMenu key={entry.path}>
                  <ContextMenuTrigger asChild>
                    <li
                      title={entry.path}
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData(PATHS_MIME, JSON.stringify([entry.path]));
                        event.dataTransfer.setData("text/plain", entry.path);
                        event.dataTransfer.effectAllowed = "copy";
                      }}
                      onClick={() => (entry.directory ? goTo(entry.relativePath) : setSelected(entry.path))}
                      onDoubleClick={() => {
                        if (!entry.directory) openOnDisk(project.root, entry.path);
                      }}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 px-3 py-1 hover:bg-accent",
                        selected === entry.path && "bg-accent",
                      )}
                    >
                      {entry.directory ? (
                        <Folder className="size-3.5 shrink-0 text-primary" />
                      ) : (
                        <File className="size-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate">{entry.name}</span>
                    </li>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onSelect={() => insertPath(entry.path)}>
                      {t("Insérer le chemin")}
                    </ContextMenuItem>
                    {!entry.directory && (
                      <>
                        <ContextMenuItem onSelect={() => setPreviewing(entry.path)}>
                          {t("Aperçu (Espace)")}
                        </ContextMenuItem>
                        <ContextMenuItem onSelect={() => openOnDisk(project.root, entry.path)}>
                          {t("Ouvrir")}
                        </ContextMenuItem>
                      </>
                    )}
                    <ContextMenuItem onSelect={() => openOnDisk(project.root, entry.path, true)}>
                      {t("Afficher dans l'Explorateur")}
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => void navigator.clipboard.writeText(entry.path)}>
                      {t("Copier le chemin")}
                    </ContextMenuItem>
                    {entry.directory && (
                      <>
                        <ContextMenuItem
                          onSelect={() => openTerminal("claude", { command: "claude", cwd: entry.path })}
                        >
                          {t("Claude ici")}
                        </ContextMenuItem>
                        <ContextMenuItem onSelect={() => openTerminal("shell", { cwd: entry.path })}>
                          {t("Shell ici")}
                        </ContextMenuItem>
                        <ContextMenuItem onSelect={() => openProject(entry.path)}>
                          {t("Ouvrir comme projet")}
                        </ContextMenuItem>
                      </>
                    )}
                  </ContextMenuContent>
                </ContextMenu>
              ))}
            </ul>
          )}
        </Async>
      </ScrollArea>
      <FilePreviewDialog
        root={project.root}
        path={previewing}
        onClose={() => setPreviewing(undefined)}
      />
    </div>
  );
}
