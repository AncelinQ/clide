import { ArrowUp, File, Folder } from "lucide-react";

import { Async, useAsync } from "@/components/common";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/lib/api";
import type { DirectoryListing } from "@/lib/types";
import { getState, openProject, updateProject, type Project } from "@/state/store";
import { openTerminal, typeInto } from "@/state/terminals";

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
  typeInto(activeTerminalId, `${path.includes(" ") ? `"${path}"` : path} `);
}

export function FileBrowser({ project }: { project: Project }) {
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
          title="Dossier parent"
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
            <ul className="m-0 list-none py-1">
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
                      onClick={() => (entry.directory ? goTo(entry.relativePath) : insertPath(entry.path))}
                      className="flex cursor-pointer items-center gap-2 px-3 py-1 hover:bg-accent"
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
                      Insérer le chemin
                    </ContextMenuItem>
                    {entry.directory && (
                      <>
                        <ContextMenuItem
                          onSelect={() => openTerminal("claude", { command: "claude", cwd: entry.path })}
                        >
                          Claude ici
                        </ContextMenuItem>
                        <ContextMenuItem onSelect={() => openTerminal("shell", { cwd: entry.path })}>
                          Shell ici
                        </ContextMenuItem>
                        <ContextMenuItem onSelect={() => openProject(entry.path)}>
                          Ouvrir comme projet
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
    </div>
  );
}
