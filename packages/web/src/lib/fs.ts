import { post } from "@/lib/api";

export type OnConflict = "ask" | "keepBoth" | "replace";

export interface Outcome {
  source: string;
  target: string;
  status: "done" | "skipped";
  conflict?: boolean;
}

/** Opérations de fichiers du serveur, bornées aux projets ouverts, à leurs liens et worktrees. */
export const fs = {
  create: (parent: string, name: string, kind: "file" | "dir") =>
    post<{ path: string }>("/api/fs/create", { parent, name, kind }).then((result) => result.path),
  rename: (path: string, name: string) => post<{ path: string }>("/api/fs/rename", { path, name }).then((result) => result.path),
  copy: (sources: string[], targetDir: string, onConflict: OnConflict = "ask") =>
    post<{ outcomes: Outcome[] }>("/api/fs/copy", { sources, targetDir, onConflict }).then((result) => result.outcomes),
  move: (sources: string[], targetDir: string, onConflict: OnConflict = "ask") =>
    post<{ outcomes: Outcome[] }>("/api/fs/move", { sources, targetDir, onConflict }).then((result) => result.outcomes),
  trash: (paths: string[]) => post<{ trashed: string[] }>("/api/fs/trash", { paths }).then((result) => result.trashed),
};

/** Dossier qui contient un chemin absolu, séparateur Windows ou POSIX. */
export function parentPath(path: string): string {
  const index = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return index <= 0 ? path : path.slice(0, index);
}

export function baseName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/")) + 1);
}
