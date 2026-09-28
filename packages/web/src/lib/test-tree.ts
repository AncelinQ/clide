import type { TestCase, TestSuite } from "@/lib/types";

export type RowStatus = "passed" | "failed" | "skipped" | "running" | "unknown";

/** Une ligne de l'arbre des tests, dans l'ordre affiché. */
export type TestRow =
  | { kind: "suite"; key: string; suite: TestSuite }
  | { kind: "file"; key: string; parent: string; suite: TestSuite; path: string }
  | { kind: "test"; key: string; parent: string; suite: TestSuite; path: string; test: TestCase };

export interface RowOptions {
  /** Suites et fichiers repliés, par clé de ligne. */
  folded: ReadonlySet<string>;
  /** Texte cherché dans le nom complet d'un test ou le chemin de son fichier. */
  query: string;
  /** Ne garder que les tests en échec. */
  failedOnly: boolean;
  status: (suite: TestSuite, path: string, test: TestCase) => RowStatus;
}

export const suiteRowKey = (suite: TestSuite): string => `${suite.directory}|${suite.framework}`;

/**
 * Les lignes visibles. Un filtre actif déplie tout ce qui lui répond : on cherche
 * pour voir. Un fichier dont le chemin répond garde tous ses tests ; un fichier ou
 * une suite sans test retenu disparaît tant qu'un filtre est actif.
 */
export function testRows(suites: readonly TestSuite[], options: RowOptions): TestRow[] {
  const query = options.query.trim().toLowerCase();
  const filtering = query !== "" || options.failedOnly;
  const rows: TestRow[] = [];
  for (const suite of suites) {
    const suiteKey = suiteRowKey(suite);
    const files: TestRow[][] = [];
    for (const file of suite.files) {
      const fileKey = `${suiteKey}|${file.path}`;
      const pathMatches = query !== "" && file.path.toLowerCase().includes(query);
      const tests = file.tests.filter((test) => {
        if (options.failedOnly && options.status(suite, file.path, test) !== "failed") return false;
        if (query === "" || pathMatches) return true;
        return [...test.parents, test.name].join(" ").toLowerCase().includes(query);
      });
      if (filtering && tests.length === 0) continue;
      const group: TestRow[] = [{ kind: "file", key: fileKey, parent: suiteKey, suite, path: file.path }];
      if (filtering || !options.folded.has(fileKey)) {
        for (const test of tests) {
          group.push({
            kind: "test",
            key: `${fileKey}|${[...test.parents, test.name].join(" › ")}|${test.line}`,
            parent: fileKey,
            suite,
            path: file.path,
            test,
          });
        }
      }
      files.push(group);
    }
    if (filtering && files.length === 0) continue;
    rows.push({ kind: "suite", key: suiteKey, suite });
    if (filtering || !options.folded.has(suiteKey)) rows.push(...files.flat());
  }
  return rows;
}

/** Ce qu'une touche fait dans l'arbre : déplacer le focus, et plier ou déplier une ligne. */
export interface Move {
  focus?: string;
  fold?: { key: string; folded: boolean };
}

/**
 * Le clavier de l'arbre, comme dans l'explorateur : haut et bas passent d'une ligne
 * à l'autre ; droite déplie, ou descend sur le premier enfant d'une ligne dépliée ;
 * gauche replie, ou remonte au parent.
 */
export function navigate(rows: readonly TestRow[], focused: string | undefined, key: string, folded: ReadonlySet<string>): Move {
  const index = rows.findIndex((row) => row.key === focused);
  const row = rows[index];
  if (key === "ArrowDown") return { focus: rows[Math.min(rows.length - 1, index + 1)]?.key ?? rows[0]?.key };
  if (key === "ArrowUp") return { focus: rows[Math.max(0, index - 1)]?.key ?? rows[0]?.key };
  if (key === "Home") return { focus: rows[0]?.key };
  if (key === "End") return { focus: rows[rows.length - 1]?.key };
  if (!row) return { focus: rows[0]?.key };
  if (key === "ArrowRight") {
    if (row.kind === "test") return {};
    if (folded.has(row.key)) return { fold: { key: row.key, folded: false } };
    const child = rows[index + 1];
    return child && child.kind !== "suite" && "parent" in child && child.parent === row.key ? { focus: child.key } : {};
  }
  if (key === "ArrowLeft") {
    if (row.kind !== "test" && !folded.has(row.key)) return { fold: { key: row.key, folded: true } };
    return row.kind === "suite" ? {} : { focus: row.parent };
  }
  return {};
}
