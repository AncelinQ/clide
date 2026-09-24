import { Check, Copy, PenLine, RotateCw } from "lucide-react";
import { useState } from "react";

import { Async, Empty, useAsync } from "@/components/common";
import { Markdown } from "@/components/Markdown";
import { formatUsd } from "@/components/panels/costs";
import { Button } from "@/components/ui/button";
import { resolvedLanguage, t } from "@/i18n";
import { api, formatDate, post } from "@/lib/api";
import type { ShownSession } from "@/components/panels/session";
import { cn } from "cn";

type Kind = "commit" | "mr";

interface SessionWriteup {
  text: string;
  at: string;
  costUsd?: number;
  model?: string;
  truncated: boolean;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 text-[11px]"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? t("Copié") : t("Copier")}
    </Button>
  );
}

/**
 * Brouillon d'un message de commit ou d'une description de merge request, rédigé
 * par `claude -p` à partir de la session.
 *
 * Le message de commit suit la convention des derniers commits du dépôt. Rien
 * n'est écrit dans git : le texte se copie, on le relit, on commite soi-même.
 */
export function WriteupPanel({ session }: { session: ShownSession }) {
  const [kind, setKind] = useState<Kind>("commit");
  const [nonce, setNonce] = useState(0);
  const state = useAsync(
    () => api<{ writeup: SessionWriteup | null }>("/api/session/writeup", { id: session.sessionId, kind }),
    [session.sessionId, kind, nonce],
  );
  const [drafting, setDrafting] = useState<Kind>();
  const [error, setError] = useState<string>();
  const [raw, setRaw] = useState(false);

  const draft = async () => {
    setDrafting(kind);
    setError(undefined);
    try {
      await post("/api/session/writeup/draft", { id: session.sessionId, kind, language: resolvedLanguage() });
      setNonce((value) => value + 1);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setDrafting(undefined);
    }
  };

  const busy = drafting === kind;
  const draftButton = (label: string) => (
    <Button variant="outline" size="sm" className="h-7 text-[11px]" disabled={busy} onClick={() => void draft()}>
      <RotateCw className={busy ? "animate-spin" : undefined} />
      {busy ? t("Claude rédige…") : label}
    </Button>
  );

  return (
    <div className="grid gap-2 py-1">
      <div className="flex gap-1">
        {(
          [
            ["commit", t("Message de commit")],
            ["mr", t("Description de MR")],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setKind(id);
              setError(undefined);
            }}
            className={cn(
              "rounded-md border px-2 py-0.5 text-[11px]",
              kind === id ? "border-primary bg-primary/10 text-foreground" : "border-transparent text-muted-foreground hover:bg-accent",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <Async state={state}>
        {({ writeup }) =>
          !writeup ? (
            <div className="grid justify-items-center gap-2 py-2">
              <Empty icon={PenLine}>
                {kind === "commit"
                  ? t(
                      "Un message de commit pour ce que la session a changé, dans la convention des derniers commits du dépôt. Rédigé par claude -p (Sonnet) : quelques centimes, à la demande. Rien n'est commité.",
                    )
                  : t(
                      "Une description de merge request — pourquoi, ce qui change, comment tester — rédigée par claude -p (Sonnet) à partir de la session : quelques centimes, à la demande.",
                    )}
              </Empty>
              {draftButton(t("Rédiger"))}
              {error && <p className="text-[11px] text-destructive">{error}</p>}
            </div>
          ) : (
            <div className="grid gap-2">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span>{formatDate(writeup.at)}</span>
                {writeup.model && <span>{writeup.model}</span>}
                {writeup.costUsd !== undefined && <span>{formatUsd(writeup.costUsd)}</span>}
                {writeup.truncated && <span>{t("session résumée : tout n'a pas été lu")}</span>}
                <span className="flex-1" />
                {kind === "mr" && (
                  <button type="button" className="underline-offset-2 hover:underline" onClick={() => setRaw((value) => !value)}>
                    {raw ? t("rendu") : t("source")}
                  </button>
                )}
                <CopyButton text={writeup.text} />
                {draftButton(t("Refaire"))}
              </div>
              {error && <p className="text-[11px] text-destructive">{error}</p>}
              {kind === "mr" && !raw ? (
                <div className="rounded-md border p-3 text-[12px]">
                  <Markdown text={writeup.text} />
                </div>
              ) : (
                <pre className="m-0 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap">
                  {writeup.text}
                </pre>
              )}
            </div>
          )
        }
      </Async>
    </div>
  );
}
