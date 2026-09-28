import { ChevronDown, ChevronRight, FlaskConical, Play, RefreshCw, Sparkles, Square } from "lucide-react";
import { useEffect, useState } from "react";

import { Empty } from "@/components/common";
import { FileIcon } from "@/components/FileIcon";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { shortName } from "@/lib/api";
import { testScriptName } from "@/lib/test-commands";
import type { TestResult, TestSuite } from "@/lib/types";
import { cn } from "cn";
import { openFile } from "@/state/editor";
import { runPrompt } from "@/state/prompts";
import { useStore } from "@/state/store";
import { interruptTerminal, runningScriptTab } from "@/state/terminals";
import { loadTests, resultOf, runTests, statusOf, suiteFile, testKey, watchTestNotice, type TestStatus } from "@/state/tests";

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

/**
 * Tests Vitest, Jest et pytest du projet et de ses espaces de travail, par
 * fichier. Chaque suite a son onglet, où tourne toute la suite, un fichier ou un
 * test ; à la fin de la commande, le rapport qu'elle a écrit donne l'état de
 * chaque test, gardé d'une session à l'autre.
 */
export function TestsPanel({ root }: { root: string }) {
  const suites = useStore((store) => store.tests[root]);
  // Les lancements en cours changent les pastilles ; les onglets, les boutons lancer / arrêter.
  useStore((store) => store.testRuns);
  useStore((store) => store.terminals);
  const [error, setError] = useState<string>();
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [opened, setOpened] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const reload = () => {
    setError(undefined);
    loadTests(root).catch((caught: unknown) => setError((caught as Error).message));
  };
  useEffect(reload, [root]);
  useEffect(() => watchTestNotice(setNotice), []);

  const fix = async (suite: TestSuite, result: TestResult) => {
    const text = t("Le test « {name} » de {file} échoue :\n{failure}\nCorrige le code ou le test.", {
      name: [...result.parents, result.name].join(" › "),
      file: suiteFile(suite, result.path),
      failure: result.failure ?? "",
    });
    setNotice(await runPrompt({ id: "fix-test", label: t("Corriger avec Claude"), text, mode: "insert", scope: "user" }));
  };

  if (error) return <p className="py-3 text-destructive">{error}</p>;
  if (!suites) return <p className="py-3 text-muted-foreground">{t("chargement…")}</p>;
  if (suites.length === 0) return <Empty icon={FlaskConical}>{t("Aucun test Vitest, Jest ou pytest dans ce projet.")}</Empty>;
  const run = (suite: TestSuite, target?: Parameters<typeof runTests>[2]) => runTests(root, suite, target);
  return (
    <div className="grid gap-3">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="flex-1">{t("Un clic sur un test l'ouvre ; ▶ le lance dans l'onglet de sa suite.")}</span>
              <Button variant="ghost" size="icon" className="size-6" title={t("Relire les fichiers de test")} onClick={reload}>
                <RefreshCw className="size-3.5" />
              </Button>
            </div>
            {notice && <p className="text-[12px] text-destructive">{notice}</p>}
            {suites.map((suite) => {
              const suiteKey = `${suite.directory}|${suite.framework}`;
              const tab = runningScriptTab(suite.directory, testScriptName(suite.framework));
              const all = suite.files.flatMap((file) => file.tests.map((test) => statusOf(suite, file.path, test.parents, test.name)));
              const failed = all.filter((status) => status === "failed").length;
              const passed = all.filter((status) => status === "passed").length;
              return (
                <div key={suiteKey} className="grid gap-1" data-suite={suite.framework}>
                  <div className="flex items-center gap-2 text-[12px]">
                    <Dot status={worst(all)} />
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {shortName(suite.directory)} <span className="font-normal text-muted-foreground">{suite.framework}</span>
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {t("{passed} ✓ · {failed} ✗ · {count} tests", { passed, failed, count: all.length })}
                    </span>
                    {tab ? (
                      <Button variant="ghost" size="icon" className="size-6 shrink-0" title={t("Arrêter (Ctrl+C)")} onClick={() => interruptTerminal(tab)}>
                        <Square className="size-3" />
                      </Button>
                    ) : (
                      <Button variant="ghost" size="icon" className="size-6 shrink-0" title={t("Lancer toute la suite")} onClick={() => run(suite)}>
                        <Play className="size-3.5" />
                      </Button>
                    )}
                  </div>
                  <ul className="m-0 list-none p-0">
                    {suite.files.map((file) => {
                      const fileKey = `${suiteKey}|${file.path}`;
                      const isFolded = folded.has(fileKey);
                      return (
                        <li key={file.path}>
                          <div className="group flex items-center gap-1 rounded px-1 py-0.5 text-[12px] hover:bg-accent">
                            <button
                              type="button"
                              className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                              onClick={() =>
                                setFolded((current) => {
                                  const next = new Set(current);
                                  if (next.has(fileKey)) next.delete(fileKey);
                                  else next.add(fileKey);
                                  return next;
                                })
                              }
                            >
                              {isFolded ? <ChevronRight className="size-3 shrink-0" /> : <ChevronDown className="size-3 shrink-0" />}
                              <Dot status={worst(file.tests.map((test) => statusOf(suite, file.path, test.parents, test.name)))} />
                              <FileIcon name={file.path.split("/").pop() ?? file.path} directory={false} className="size-3.5 shrink-0" />
                              <span className="truncate">{file.path}</span>
                            </button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-6 shrink-0 opacity-0 group-hover:opacity-100"
                              title={t("Lancer ce fichier")}
                              disabled={!!tab}
                              onClick={() => run(suite, { path: file.path })}
                            >
                              <Play className="size-3" />
                            </Button>
                          </div>
                          {!isFolded && (
                            <ul className="m-0 list-none p-0 pl-5">
                              {file.tests.map((test) => {
                                const key = testKey(file.path, test.parents, test.name);
                                const result = resultOf(suite, file.path, test.parents, test.name);
                                const status = statusOf(suite, file.path, test.parents, test.name);
                                return (
                                  <li key={`${key}|${test.line}`}>
                                    <div className="group flex items-center gap-1.5 rounded px-1 py-0.5 text-[12px] hover:bg-accent" data-test={test.name} data-status={status}>
                                      <Dot status={status} />
                                      <button
                                        type="button"
                                        className="min-w-0 flex-1 truncate text-left"
                                        title={[...test.parents, test.name].join(" › ")}
                                        onClick={() => {
                                          void openFile(suiteFile(suite, file.path), { line: test.line });
                                          if (result?.failure) setOpened(opened === `${suiteKey}|${key}` ? undefined : `${suiteKey}|${key}`);
                                        }}
                                      >
                                        {test.parents.length > 0 && <span className="text-muted-foreground">{test.parents.join(" › ")} › </span>}
                                        {test.name}
                                      </button>
                                      {result?.durationMs !== undefined && (
                                        <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">{result.durationMs} ms</span>
                                      )}
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="size-6 shrink-0 opacity-0 group-hover:opacity-100"
                                        title={t("Lancer ce test")}
                                        disabled={!!tab}
                                        onClick={() => run(suite, { path: file.path, name: test.name, parents: test.parents })}
                                      >
                                        <Play className="size-3" />
                                      </Button>
                                    </div>
                                    {opened === `${suiteKey}|${key}` && result?.failure && (
                                      <div className="mb-1 ml-4 grid gap-1 border-l-2 border-destructive/60 pl-2">
                                        <pre className="max-h-48 overflow-auto font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">{result.failure}</pre>
                                        <div>
                                          <Button variant="outline" size="sm" className="h-6 text-[11px]" onClick={() => void fix(suite, result)}>
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
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
      })}
    </div>
  );
}
