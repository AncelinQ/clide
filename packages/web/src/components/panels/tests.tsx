import { ChevronDown, ChevronRight, FlaskConical, Play, RefreshCw, Sparkles, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Async, Empty, useAsync } from "@/components/common";
import { FileIcon } from "@/components/FileIcon";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { api, shortName } from "@/lib/api";
import { buildTestCommand, testScriptName, type TestTarget } from "@/lib/test-commands";
import type { TestResult, TestSuite } from "@/lib/types";
import { cn } from "cn";
import { openFile } from "@/state/editor";
import { runPrompt } from "@/state/prompts";
import { useStore } from "@/state/store";
import { interruptTerminal, runScript, runningScriptTab, scriptKey } from "@/state/terminals";

type Status = TestResult["status"] | "running" | "unknown";

const STATUS_DOT: Record<Status, string> = {
  passed: "bg-emerald-500",
  failed: "bg-destructive",
  skipped: "bg-muted-foreground/50",
  running: "animate-pulse bg-sky-500",
  unknown: "border border-muted-foreground/40",
};

function keyOf(path: string, parents: readonly string[], name: string): string {
  return [path, ...parents, name].join(" › ");
}

function absolute(directory: string, path: string): string {
  return `${directory.replace(/[\\/]+$/, "")}\\${path.split("/").join("\\")}`;
}

/** Le pire statut d'un ensemble : un échec l'emporte, puis l'inconnu. */
function worst(statuses: Status[]): Status {
  for (const status of ["running", "failed", "unknown", "passed", "skipped"] as const) if (statuses.includes(status)) return status;
  return "unknown";
}

function Dot({ status }: { status: Status }) {
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", STATUS_DOT[status])} />;
}

/** Un lancement suivi jusqu'à la fin de sa commande, pour relire son rapport. */
interface Launch {
  suite: TestSuite;
  since: number;
  /** Ce qui tourne : on le montre en cours tant que la commande n'a pas fini. */
  target: TestTarget;
  seenRunning: boolean;
}

/**
 * Tests Vitest, Jest et pytest du projet et de ses espaces de travail, par
 * fichier. Chaque suite a son onglet, où tourne toute la suite, un fichier ou un
 * test ; à la fin de la commande, le rapport qu'elle a écrit donne l'état de
 * chaque test, gardé d'une session à l'autre.
 */
export function TestsPanel({ root }: { root: string }) {
  const [nonce, setNonce] = useState(0);
  const state = useAsync(() => api<{ suites: TestSuite[] }>("/api/tests", { root }), [root], nonce);
  const [results, setResults] = useState<Record<string, TestResult[]>>({});
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [opened, setOpened] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const launches = useRef(new Map<string, Launch>());
  const [, setTick] = useState(0);
  const terminals = useStore((store) => store.terminals);

  useEffect(() => {
    const next: Record<string, TestResult[]> = {};
    for (const suite of state.data?.suites ?? []) next[`${suite.directory}|${suite.framework}`] = suite.results;
    setResults(next);
  }, [state.data]);

  // La fin d'une commande de test se voit à l'état de son onglet : on relit alors le rapport.
  useEffect(() => {
    for (const [key, launch] of launches.current) {
      const tab = Object.values(terminals).find((entry) => entry.owner === root && entry.info.script === key)?.info;
      if (!tab) continue;
      if (tab.state === "running" && !tab.exited) {
        launch.seenRunning = true;
        continue;
      }
      if (!launch.seenRunning && !tab.exited) continue;
      launches.current.delete(key);
      setTick((value) => value + 1);
      const { suite, since, target } = launch;
      const only = target.path && target.name ? { only: keyOf(target.path, target.parents ?? [], target.name) } : {};
      api<{ results: TestResult[]; stale?: boolean }>("/api/tests/results", {
        directory: suite.directory,
        framework: suite.framework,
        since: String(since),
        ...only,
      })
        .then((answer) => {
          setResults((current) => ({ ...current, [`${suite.directory}|${suite.framework}`]: answer.results }));
          setNotice(answer.stale ? t("Aucun rapport de test n'a été écrit : regarde la sortie dans l'onglet.") : undefined);
        })
        .catch((caught: unknown) => setNotice((caught as Error).message));
    }
  }, [terminals, root]);

  const run = (suite: TestSuite, target: TestTarget = {}) => {
    const name = testScriptName(suite.framework);
    const key = scriptKey(suite.directory, name);
    if (runningScriptTab(suite.directory, name)) return;
    launches.current.set(key, { suite, since: Date.now(), target, seenRunning: false });
    setTick((value) => value + 1);
    setNotice(undefined);
    runScript(name, suite.directory, buildTestCommand(suite.framework, suite.reportPath, target));
  };

  const fix = async (suite: TestSuite, result: TestResult) => {
    const text = t("Le test « {name} » de {file} échoue :\n{failure}\nCorrige le code ou le test.", {
      name: [...result.parents, result.name].join(" › "),
      file: absolute(suite.directory, result.path),
      failure: result.failure ?? "",
    });
    setNotice(await runPrompt({ id: "fix-test", label: t("Corriger avec Claude"), text, mode: "insert", scope: "user" }));
  };

  return (
    <Async state={state}>
      {({ suites }) => {
        if (suites.length === 0) return <Empty icon={FlaskConical}>{t("Aucun test Vitest, Jest ou pytest dans ce projet.")}</Empty>;
        return (
          <div className="grid gap-3">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="flex-1">{t("Un clic sur un test l'ouvre ; ▶ le lance dans l'onglet de sa suite.")}</span>
              <Button variant="ghost" size="icon" className="size-6" title={t("Relire les fichiers de test")} onClick={() => setNonce((value) => value + 1)}>
                <RefreshCw className="size-3.5" />
              </Button>
            </div>
            {notice && <p className="text-[12px] text-destructive">{notice}</p>}
            {suites.map((suite) => {
              const suiteKey = `${suite.directory}|${suite.framework}`;
              const byKey = new Map((results[suiteKey] ?? []).map((result) => [keyOf(result.path, result.parents, result.name), result]));
              const scriptName = testScriptName(suite.framework);
              const tab = runningScriptTab(suite.directory, scriptName);
              const launch = launches.current.get(scriptKey(suite.directory, scriptName));
              const covers = (path: string, parents: string[], name: string) =>
                !!launch &&
                (!launch.target.path || (launch.target.path === path && (!launch.target.name || keyOf(path, launch.target.parents ?? [], launch.target.name) === keyOf(path, parents, name))));
              const statusOf = (path: string, parents: string[], name: string): Status =>
                covers(path, parents, name) ? "running" : (byKey.get(keyOf(path, parents, name))?.status ?? "unknown");
              const all = suite.files.flatMap((file) => file.tests.map((test) => statusOf(file.path, test.parents, test.name)));
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
                              <Dot status={worst(file.tests.map((test) => statusOf(file.path, test.parents, test.name)))} />
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
                                const testKey = keyOf(file.path, test.parents, test.name);
                                const result = byKey.get(testKey);
                                const status = statusOf(file.path, test.parents, test.name);
                                return (
                                  <li key={`${testKey}|${test.line}`}>
                                    <div className="group flex items-center gap-1.5 rounded px-1 py-0.5 text-[12px] hover:bg-accent" data-test={test.name} data-status={status}>
                                      <Dot status={status} />
                                      <button
                                        type="button"
                                        className="min-w-0 flex-1 truncate text-left"
                                        title={[...test.parents, test.name].join(" › ")}
                                        onClick={() => {
                                          void openFile(absolute(suite.directory, file.path), { line: test.line });
                                          if (result?.failure) setOpened(opened === `${suiteKey}|${testKey}` ? undefined : `${suiteKey}|${testKey}`);
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
                                    {opened === `${suiteKey}|${testKey}` && result?.failure && (
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
      }}
    </Async>
  );
}
