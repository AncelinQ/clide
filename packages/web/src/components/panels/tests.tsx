import { ChevronDown, ChevronRight, FlaskConical, Play, RefreshCw, Sparkles, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { Empty } from "@/components/common";
import { FileIcon } from "@/components/FileIcon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { shortName } from "@/lib/api";
import { testScriptName, type TestTarget } from "@/lib/test-commands";
import { navigate, testRows, type TestRow } from "@/lib/test-tree";
import type { TestResult, TestSuite } from "@/lib/types";
import { cn } from "cn";
import { openFile } from "@/state/editor";
import { runPrompt } from "@/state/prompts";
import { useStore } from "@/state/store";
import { interruptTerminal, runningScriptTab } from "@/state/terminals";
import { loadTests, resultOf, runTests, statusOf, suiteFile, watchTestNotice, type TestStatus } from "@/state/tests";

const STATUS_DOT: Record<TestStatus, string> = {
  passed: "bg-emerald-500",
  failed: "bg-destructive",
  skipped: "bg-muted-foreground/50",
  running: "animate-pulse bg-sky-500",
  unknown: "border border-muted-foreground/40",
};

/** Le pire statut d'un ensemble : un lancement en cours l'emporte, puis un échec. */
function worst(statuses: TestStatus[]): TestStatus {
  for (const status of ["running", "failed", "unknown", "passed", "skipped"] as const) if (statuses.includes(status)) return status;
  return "unknown";
}

function Dot({ status }: { status: TestStatus }) {
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", STATUS_DOT[status])} />;
}

/** Ce que lance une ligne : toute la suite, un fichier, ou un test. */
function targetOf(row: TestRow): TestTarget {
  if (row.kind === "suite") return {};
  if (row.kind === "file") return { path: row.path };
  return { path: row.path, name: row.test.name, parents: row.test.parents };
}

/**
 * Tests Vitest, Jest et pytest du projet et de ses espaces de travail, par
 * fichier. Chaque suite a son onglet, où tourne toute la suite, un fichier ou un
 * test ; à la fin de la commande, le rapport qu'elle a écrit donne l'état de
 * chaque test, gardé d'une session à l'autre.
 *
 * L'arbre se filtre, et se parcourt au clavier comme l'explorateur : flèches,
 * `→` / `←` pour déplier et replier, Entrée pour lancer, Espace pour ouvrir.
 */
export function TestsPanel({ root }: { root: string }) {
  const suites = useStore((store) => store.tests[root]);
  // Les lancements en cours changent les pastilles ; les onglets, les boutons lancer / arrêter.
  const testRuns = useStore((store) => store.testRuns);
  useStore((store) => store.terminals);
  const [error, setError] = useState<string>();
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [opened, setOpened] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [query, setQuery] = useState("");
  const [failedOnly, setFailedOnly] = useState(false);
  const [focused, setFocused] = useState<string>();
  const tree = useRef<HTMLUListElement>(null);

  const reload = () => {
    setError(undefined);
    loadTests(root).catch((caught: unknown) => setError((caught as Error).message));
  };
  useEffect(reload, [root]);
  useEffect(() => watchTestNotice(setNotice), []);

  const rows = useMemo(
    () => testRows(suites ?? [], { folded, query, failedOnly, status: (suite, path, test) => statusOf(suite, path, test.parents, test.name) }),
    // Les statuts changent avec les lancements (`testRuns`) et les résultats (`suites`).
    [suites, folded, query, failedOnly, testRuns],
  );

  // La ligne focalisée reste visible quand on la parcourt au clavier.
  useEffect(() => {
    if (!focused) return;
    tree.current?.querySelector(`[data-row="${CSS.escape(focused)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [focused]);

  const fix = async (suite: TestSuite, result: TestResult) => {
    const text = t("Le test « {name} » de {file} échoue :\n{failure}\nCorrige le code ou le test.", {
      name: [...result.parents, result.name].join(" › "),
      file: suiteFile(suite, result.path),
      failure: result.failure ?? "",
    });
    setNotice(await runPrompt({ id: "fix-test", label: t("Corriger avec Claude"), text, mode: "insert", scope: "user" }));
  };

  const setFold = (key: string, value: boolean) =>
    setFolded((current) => {
      const next = new Set(current);
      if (value) next.add(key);
      else next.delete(key);
      return next;
    });

  if (error) return <p className="py-3 text-destructive">{error}</p>;
  if (!suites) return <p className="py-3 text-muted-foreground">{t("chargement…")}</p>;
  if (suites.length === 0) return <Empty icon={FlaskConical}>{t("Aucun test Vitest, Jest ou pytest dans ce projet.")}</Empty>;

  const tabOf = (suite: TestSuite) => runningScriptTab(suite.directory, testScriptName(suite.framework));
  const run = (suite: TestSuite, target?: TestTarget) => runTests(root, suite, target);
  const statusOfRow = (row: TestRow): TestStatus => {
    if (row.kind === "test") return statusOf(row.suite, row.path, row.test.parents, row.test.name);
    const files = row.kind === "file" ? row.suite.files.filter((file) => file.path === row.path) : row.suite.files;
    return worst(files.flatMap((file) => file.tests.map((test) => statusOf(row.suite, file.path, test.parents, test.name))));
  };
  /** Ouvre un test à sa ligne ; sur un échec, déplie aussi son message. */
  const open = (row: Extract<TestRow, { kind: "test" }>) => {
    void openFile(suiteFile(row.suite, row.path), { line: row.test.line });
    if (resultOf(row.suite, row.path, row.test.parents, row.test.name)?.failure) setOpened(opened === row.key ? undefined : row.key);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const row = rows.find((item) => item.key === focused);
    if (event.key === "Enter" && row) {
      event.preventDefault();
      if (!tabOf(row.suite)) run(row.suite, targetOf(row));
      return;
    }
    if (event.key === " " && row) {
      event.preventDefault();
      if (row.kind === "test") open(row);
      else setFold(row.key, !folded.has(row.key));
      return;
    }
    const move = navigate(rows, focused, event.key, folded);
    if (!move.focus && !move.fold) return;
    event.preventDefault();
    if (move.fold) setFold(move.fold.key, move.fold.folded);
    if (move.focus) setFocused(move.focus);
  };

  return (
    <div className="grid grid-cols-1 gap-2">
      <div className="flex items-center gap-1">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            // Descendre depuis le filtre entre dans l'arbre.
            if (event.key === "ArrowDown" && rows[0]) {
              event.preventDefault();
              setFocused(rows[0].key);
              tree.current?.focus();
            }
          }}
          placeholder={t("Filtrer les tests…")}
          spellCheck={false}
          className="h-7 flex-1 text-[12px]"
          data-tests-filter
        />
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={failedOnly}
          className={cn("h-7 px-2 text-[11px]", failedOnly && "bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive")}
          title={t("Ne montrer que les tests en échec")}
          onClick={() => setFailedOnly((value) => !value)}
          data-failed-only
        >
          {t("échecs")}
        </Button>
        <Button variant="ghost" size="icon" className="size-7" title={t("Relire les fichiers de test")} onClick={reload}>
          <RefreshCw className="size-3.5" />
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {t("Un clic ou Espace ouvre un test, ▶ ou Entrée le lance ; flèches pour parcourir, → et ← pour déplier et replier.")}
      </p>
      {notice && <p className="text-[12px] text-destructive">{notice}</p>}
      {rows.length === 0 ? (
        <p className="py-2 text-[12px] text-muted-foreground">{t("Aucun test ne répond au filtre.")}</p>
      ) : (
        <ul
          ref={tree}
          tabIndex={0}
          role="tree"
          aria-label={t("Tests")}
          className="m-0 list-none p-0 outline-none"
          onKeyDown={onKeyDown}
          onFocus={() => !focused && rows[0] && setFocused(rows[0].key)}
          data-tests-tree
        >
          {rows.map((row) => {
            const tab = tabOf(row.suite);
            const status = statusOfRow(row);
            const isFocused = row.key === focused;
            const indent = row.kind === "suite" ? "" : row.kind === "file" ? "pl-3" : "pl-8";
            const result = row.kind === "test" ? resultOf(row.suite, row.path, row.test.parents, row.test.name) : undefined;
            const toggle = () => setFold(row.key, !folded.has(row.key));
            return (
              <li key={row.key} role="treeitem" aria-selected={isFocused} data-row={row.key}>
                <div
                  className={cn(
                    "group flex items-center gap-1.5 rounded px-1 py-0.5 text-[12px] hover:bg-accent",
                    indent,
                    isFocused && "bg-accent ring-1 ring-ring/40",
                    row.kind === "suite" && "mt-1",
                  )}
                  {...(row.kind === "test" ? { "data-test": row.test.name, "data-status": status } : {})}
                  {...(row.kind === "suite" ? { "data-suite": row.suite.framework } : {})}
                >
                  {row.kind !== "test" && (
                    <button type="button" className="grid size-4 shrink-0 place-items-center" onClick={toggle} tabIndex={-1}>
                      {folded.has(row.key) && !query && !failedOnly ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
                    </button>
                  )}
                  <Dot status={status} />
                  {row.kind === "suite" ? (
                    <button type="button" tabIndex={-1} className="min-w-0 flex-1 truncate text-left font-medium" onClick={() => setFocused(row.key)}>
                      {shortName(row.suite.directory)} <span className="font-normal text-muted-foreground">{row.suite.framework}</span>
                    </button>
                  ) : row.kind === "file" ? (
                    <button type="button" tabIndex={-1} className="flex min-w-0 flex-1 items-center gap-1.5 text-left" onClick={() => setFocused(row.key)}>
                      <FileIcon name={row.path.split("/").pop() ?? row.path} directory={false} className="size-3.5 shrink-0" />
                      <span className="truncate">{row.path}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      tabIndex={-1}
                      className="min-w-0 flex-1 truncate text-left"
                      title={[...row.test.parents, row.test.name].join(" › ")}
                      onClick={() => {
                        setFocused(row.key);
                        open(row);
                      }}
                    >
                      {row.test.parents.length > 0 && <span className="text-muted-foreground">{row.test.parents.join(" › ")} › </span>}
                      {row.test.name}
                    </button>
                  )}
                  {row.kind === "suite" && <SuiteCounts suite={row.suite} />}
                  {result?.durationMs !== undefined && <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">{result.durationMs} ms</span>}
                  {row.kind === "suite" && tab ? (
                    <Button variant="ghost" size="icon" tabIndex={-1} className="size-6 shrink-0" title={t("Arrêter (Ctrl+C)")} onClick={() => interruptTerminal(tab)}>
                      <Square className="size-3" />
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      tabIndex={-1}
                      className={cn("size-6 shrink-0", row.kind !== "suite" && "opacity-0 group-hover:opacity-100", isFocused && "opacity-100")}
                      title={row.kind === "suite" ? t("Lancer toute la suite") : row.kind === "file" ? t("Lancer ce fichier") : t("Lancer ce test")}
                      disabled={!!tab}
                      onClick={() => run(row.suite, targetOf(row))}
                    >
                      <Play className={row.kind === "suite" ? "size-3.5" : "size-3"} />
                    </Button>
                  )}
                </div>
                {row.kind === "test" && opened === row.key && result?.failure && (
                  <div className="mb-1 ml-10 grid gap-1 border-l-2 border-destructive/60 pl-2">
                    <pre className="max-h-48 overflow-auto font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">{result.failure}</pre>
                    <div>
                      <Button variant="outline" size="sm" className="h-6 text-[11px]" onClick={() => void fix(row.suite, result)}>
                        <Sparkles className="size-3" /> {t("Corriger avec Claude")}
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Réussis, échoués et total d'une suite, sur tous ses tests, filtre ou pas. */
function SuiteCounts({ suite }: { suite: TestSuite }) {
  const all = suite.files.flatMap((file) => file.tests.map((test) => statusOf(suite, file.path, test.parents, test.name)));
  const passed = all.filter((status) => status === "passed").length;
  const failed = all.filter((status) => status === "failed").length;
  return (
    <span className="shrink-0 text-[11px] text-muted-foreground">
      {t("{passed} ✓ · {failed} ✗ · {count} tests", { passed, failed, count: all.length })}
    </span>
  );
}
