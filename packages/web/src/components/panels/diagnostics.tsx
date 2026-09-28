import { ChevronDown, ChevronRight, RefreshCw, Sparkles } from "lucide-react";
import { useState } from "react";

import { FileIcon } from "@/components/FileIcon";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { formatDate, post } from "@/lib/api";
import type { Diagnostic } from "@/lib/types";
import { cn } from "cn";
import { openFile } from "@/state/editor";
import { runPrompt } from "@/state/prompts";
import { useStore } from "@/state/store";

const SEVERITY_DOT: Record<Diagnostic["severity"], string> = {
  error: "bg-destructive",
  warning: "bg-amber-500",
  info: "bg-sky-500",
};

function relative(root: string, path: string): string {
  const clean = (value: string) => value.replace(/\//g, "\\");
  const base = clean(root);
  const target = clean(path);
  return target.toLowerCase().startsWith(`${base.toLowerCase()}\\`) ? target.slice(base.length + 1) : target;
}

/**
 * Les erreurs de `tsc` et d'ESLint du projet, ou ses TODO, groupés par fichier.
 * Le serveur les recalcule seul — projet ouvert, fichier enregistré, fin d'un
 * tour de Claude — et les pousse ; rien n'est demandé ici en boucle.
 */
export function DiagnosticsPanel({ root, kind }: { root: string; kind: "errors" | "todos" }) {
  const report = useStore((state) => state.diagnostics[root]);
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string>();

  const tools = (report?.tools ?? []).filter((tool) => (kind === "todos" ? tool.tool === "todo" : tool.tool !== "todo"));
  const items = tools.flatMap((tool) => tool.diagnostics);
  const failures = tools.filter((tool) => tool.error);
  const byFile = new Map<string, Diagnostic[]>();
  for (const item of items) byFile.set(item.path, [...(byFile.get(item.path) ?? []), item]);
  const rank = (list: Diagnostic[]) => (list.some((item) => item.severity === "error") ? 0 : 1);
  const files = [...byFile.entries()].sort((a, b) => rank(a[1]) - rank(b[1]) || a[0].localeCompare(b[0]));

  const fix = async (item: Diagnostic) => {
    const where = `${relative(root, item.path)}:${item.line}`;
    const text =
      item.source === "todo"
        ? t("Traite le {code} de {where} : {message}", { code: item.code ?? "TODO", where, message: item.message })
        : t("Corrige l'erreur {code} de {where} : {message}", { code: item.code ?? item.source, where, message: item.message });
    setNotice(await runPrompt({ id: "fix", label: t("Corriger avec Claude"), text, mode: "insert", scope: "user" }));
  };

  const ranAt = tools.map((tool) => tool.ranAt).sort().at(-1);
  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="flex-1">
          {!report
            ? t("Vérification à venir : à l'ouverture du projet, à chaque enregistrement et à chaque fin de tour de Claude.")
            : items.length === 0
              ? kind === "todos"
                ? t("Aucun TODO.")
                : tools.length === 0
                  ? t("Ni tsc ni ESLint dans ce projet.")
                  : t("Aucune erreur.")
              : t("{count} dans {files} fichier(s)", { count: items.length, files: files.length })}
          {ranAt && <span className="ml-2">· {formatDate(ranAt)}</span>}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          title={t("Vérifier maintenant")}
          onClick={() => void post("/api/diagnostics/run", { root })}
        >
          <RefreshCw className="size-3.5" />
        </Button>
      </div>
      {failures.map((tool) => (
        <p key={tool.tool} className="rounded border border-destructive/40 px-2 py-1 font-mono text-[11px] whitespace-pre-wrap text-destructive">
          {tool.tool} : {tool.error}
        </p>
      ))}
      {notice && <p className="text-[12px] text-amber-600 dark:text-amber-400">{notice}</p>}
      <ul className="m-0 list-none p-0">
        {files.map(([path, list]) => {
          const open = !folded.has(path);
          const name = relative(root, path);
          return (
            <li key={path}>
              <button
                type="button"
                className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-[12px] hover:bg-accent"
                onClick={() =>
                  setFolded((current) => {
                    const next = new Set(current);
                    if (next.has(path)) next.delete(path);
                    else next.add(path);
                    return next;
                  })
                }
              >
                {open ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
                <FileIcon name={name.split("\\").pop() ?? name} directory={false} className="size-3.5" />
                <span className="min-w-0 flex-1 truncate">{name}</span>
                <span className="text-[11px] text-muted-foreground">{list.length}</span>
              </button>
              {open && (
                <ul className="m-0 list-none p-0 pl-5">
                  {list
                    .sort((a, b) => a.line - b.line)
                    .map((item, index) => (
                      <li
                        key={`${item.line}:${item.column}:${index}`}
                        className="group flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 text-[12px] hover:bg-accent"
                        onClick={() => void openFile(path, { line: item.line, column: item.column })}
                      >
                        <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", SEVERITY_DOT[item.severity])} />
                        <span className="min-w-0 flex-1 break-words whitespace-pre-wrap">
                          {item.message}
                          <span className="ml-1.5 text-[10.5px] text-muted-foreground">
                            {item.code ?? item.source} · {item.line}:{item.column}
                          </span>
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6 shrink-0 opacity-0 group-hover:opacity-100"
                          title={t("Corriger avec Claude")}
                          onClick={(event) => {
                            event.stopPropagation();
                            void fix(item);
                          }}
                        >
                          <Sparkles className="size-3.5" />
                        </Button>
                      </li>
                    ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
