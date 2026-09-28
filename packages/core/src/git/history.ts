/**
 * Lecture des sorties de git pour le module Git : les fichiers modifiés, le
 * journal et ses voies de graphe, le détail d'un commit. Fonctions pures : le
 * serveur lance git, ces fonctions lisent ce qu'il a écrit.
 */

/** Ce qu'il est advenu d'un fichier depuis le dernier commit. */
export type ChangeKind = "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflict";

export interface Change {
  /** Chemin relatif à la racine du dépôt, séparé par `/`. */
  path: string;
  /** Ancien chemin d'un renommage. */
  from?: string;
  kind: ChangeKind;
  /** Une partie est déjà dans l'index. */
  staged: boolean;
}

function kindOf(code: string): ChangeKind {
  if (code.includes("D")) return "deleted";
  if (code.includes("A")) return "added";
  return "modified";
}

/**
 * Lit `git status --porcelain=v2 -z --untracked-files=all`. Avec `-z`, un nom
 * garde ses espaces et ses accents tels quels ; un renommage porte l'ancien nom
 * dans l'entrée suivante.
 */
export function parseChanges(text: string): Change[] {
  const entries = text.split("\0");
  const changes: Change[] = [];
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index] ?? "";
    if (!entry) continue;
    const type = entry[0];
    if (type === "?") {
      changes.push({ path: entry.slice(2), kind: "untracked", staged: false });
    } else if (type === "u") {
      changes.push({ path: entry.split(" ").slice(10).join(" "), kind: "conflict", staged: false });
    } else if (type === "1") {
      const fields = entry.split(" ");
      const xy = fields[1] ?? "..";
      changes.push({ path: fields.slice(8).join(" "), kind: kindOf(xy), staged: xy[0] !== "." });
    } else if (type === "2") {
      const fields = entry.split(" ");
      const xy = fields[1] ?? "..";
      const from = entries[index + 1] ?? "";
      index += 1;
      changes.push({ path: fields.slice(9).join(" "), from, kind: "renamed", staged: xy[0] !== "." });
    }
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

export interface Commit {
  hash: string;
  parents: string[];
  author: string;
  /** Date ISO de l'auteur. */
  date: string;
  /** Branches et étiquettes qui pointent ici, comme `git log --decorate` les nomme. */
  refs: string[];
  subject: string;
}

/** Séparateurs du format demandé au journal : ni un sujet ni un nom ne les contiennent. */
export const LOG_FORMAT = "%H%x1f%P%x1f%an%x1f%aI%x1f%D%x1f%s%x1e";

export function parseCommits(text: string): Commit[] {
  return text
    .split("\x1e")
    .map((record) => record.replace(/^\s+/, ""))
    .filter(Boolean)
    .map((record) => {
      const [hash = "", parents = "", author = "", date = "", refs = "", subject = ""] = record.split("\x1f");
      return {
        hash,
        parents: parents.split(" ").filter(Boolean),
        author,
        date,
        refs: refs
          .split(", ")
          .map((ref) => ref.replace(/^HEAD -> /, "").trim())
          .filter((ref) => ref && ref !== "HEAD"),
        subject,
      };
    });
}

/** Une ligne du graphe : la voie du commit, et les voies ouvertes avant et après lui. */
export interface GraphRow {
  hash: string;
  /** Colonne du point du commit. */
  column: number;
  /** Commit attendu par chaque voie en arrivant sur la ligne ; `null` : voie libre. */
  before: (string | null)[];
  /** Commit attendu par chaque voie en quittant la ligne. */
  after: (string | null)[];
}

/**
 * Range les commits en voies, comme `git log --graph` : chaque voie attend un
 * commit ; un commit prend la voie qui l'attend (la plus à gauche s'il y en a
 * plusieurs, les autres se referment sur lui), la passe à son premier parent,
 * et ouvre une voie par parent supplémentaire. Le journal doit être dans l'ordre
 * topologique (`--topo-order`) pour que chaque enfant précède ses parents.
 */
export function graphRows(commits: readonly Commit[]): GraphRow[] {
  let lanes: (string | null)[] = [];
  const rows: GraphRow[] = [];
  for (const commit of commits) {
    const before = [...lanes];
    let column = lanes.indexOf(commit.hash);
    if (column === -1) {
      column = lanes.indexOf(null);
      if (column === -1) column = lanes.length;
    }
    const after = lanes.map((hash) => (hash === commit.hash ? null : hash));
    const [first, ...others] = commit.parents;
    after[column] = first ?? null;
    for (const parent of others) {
      if (after.includes(parent)) continue;
      const free = after.indexOf(null);
      if (free === -1) after.push(parent);
      else after[free] = parent;
    }
    while (after.length > 0 && after[after.length - 1] === null) after.pop();
    rows.push({ hash: commit.hash, column, before, after });
    lanes = after;
  }
  return rows;
}

/** Un fichier d'un commit, lu par `git show --name-status -z`. */
export interface CommitFile {
  path: string;
  from?: string;
  kind: Exclude<ChangeKind, "untracked" | "conflict">;
}

export function parseNameStatus(text: string): CommitFile[] {
  const entries = text.split("\0").filter((entry, index, all) => entry !== "" || index < all.length - 1);
  const files: CommitFile[] = [];
  for (let index = 0; index < entries.length; index++) {
    const status = (entries[index] ?? "").trim();
    if (!status) continue;
    const letter = status[0];
    if (letter === "R" || letter === "C") {
      const from = entries[index + 1] ?? "";
      const path = entries[index + 2] ?? "";
      index += 2;
      files.push(letter === "R" ? { path, from, kind: "renamed" } : { path, kind: "added" });
    } else {
      const path = entries[index + 1] ?? "";
      index += 1;
      files.push({ path, kind: letter === "A" ? "added" : letter === "D" ? "deleted" : "modified" });
    }
  }
  return files;
}
