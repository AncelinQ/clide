import { Maximize2, RotateCw, Workflow } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { Async, Empty, useAsync } from "@/components/common";
import { formatUsd } from "@/components/panels/costs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { resolvedLanguage, t } from "@/i18n";
import { api, formatDate, post } from "@/lib/api";
import type { ShownSession } from "@/components/panels/session";

interface SessionDiagram {
  mermaid: string;
  at: string;
  costUsd?: number;
  model?: string;
  truncated: boolean;
}

/**
 * Rendu d'une source Mermaid en SVG.
 *
 * La bibliothèque pèse lourd : elle ne se charge qu'au premier schéma montré.
 * `securityLevel: "strict"` neutralise le HTML et les liens qu'une réponse de
 * Claude glisserait dans les libellés.
 */
function MermaidView({ source, className }: { source: string; className?: string }) {
  const id = `mermaid-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [svg, setSvg] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    void import("mermaid")
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: document.documentElement.classList.contains("dark") ? "dark" : "default",
        });
        const { svg: rendered } = await mermaid.render(id, source);
        if (!cancelled) setSvg(rendered);
      })
      .catch((caught: Error) => !cancelled && setError(caught.message));
    return () => {
      cancelled = true;
    };
  }, [id, source]);

  if (error) {
    return (
      <div className="grid gap-1.5">
        <p className="text-[11px] text-destructive">{t("Schéma illisible : {error}", { error })}</p>
        <pre className="m-0 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-[11px]">{source}</pre>
      </div>
    );
  }
  if (!svg) return <div className="h-32 animate-pulse rounded-md border bg-muted/40" />;
  return <div className={className} dangerouslySetInnerHTML={{ __html: svg }} />;
}

/**
 * Ce que la session a changé, en un diagramme rédigé par `claude -p` à partir de
 * ses demandes et de ses diffs.
 *
 * Il coûte des tokens : rien ne part sans un clic, et le schéma obtenu est gardé
 * jusqu'à ce qu'on le refasse.
 */
export function DiagramPanel({ session }: { session: ShownSession }) {
  const [nonce, setNonce] = useState(0);
  const state = useAsync(
    () => api<{ diagram: SessionDiagram | null }>("/api/session/diagram", { id: session.sessionId }),
    [session.sessionId, nonce],
  );
  const [drawing, setDrawing] = useState(false);
  const [error, setError] = useState<string>();
  const [showSource, setShowSource] = useState(false);
  const [enlarged, setEnlarged] = useState(false);

  const draw = async () => {
    setDrawing(true);
    setError(undefined);
    try {
      await post("/api/session/diagram/draw", { id: session.sessionId, language: resolvedLanguage() });
      setNonce((value) => value + 1);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setDrawing(false);
    }
  };

  const drawButton = (label: string) => (
    <Button variant="outline" size="sm" className="h-7 text-[11px]" disabled={drawing} onClick={() => void draw()}>
      <RotateCw className={drawing ? "animate-spin" : undefined} />
      {drawing ? t("Claude dessine…") : label}
    </Button>
  );

  return (
    <Async state={state}>
      {({ diagram }) =>
        !diagram ? (
          <div className="grid justify-items-center gap-2 py-3">
            <Empty icon={Workflow}>
              {t(
                "Un diagramme de ce que la session a changé, rédigé par claude -p (Sonnet) à partir de ses demandes et de ses diffs. Il coûte quelques centimes, jamais plus d'un dollar, et n'est fait qu'à la demande.",
              )}
            </Empty>
            {drawButton(t("Dessiner le schéma"))}
            {error && <p className="text-[11px] text-destructive">{error}</p>}
          </div>
        ) : (
          <div className="grid gap-2 py-1">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <span>{formatDate(diagram.at)}</span>
              {diagram.model && <span>{diagram.model}</span>}
              {diagram.costUsd !== undefined && <span>{formatUsd(diagram.costUsd)}</span>}
              {diagram.truncated && <span>{t("session résumée : tout n'a pas été lu")}</span>}
              <span className="flex-1" />
              <button
                type="button"
                className="underline-offset-2 hover:underline"
                onClick={() => setShowSource((value) => !value)}
              >
                {showSource ? t("schéma") : t("source")}
              </button>
              <Button variant="ghost" size="icon" className="size-6" title={t("Agrandir")} onClick={() => setEnlarged(true)}>
                <Maximize2 />
              </Button>
              {drawButton(t("Refaire"))}
            </div>
            {error && <p className="text-[11px] text-destructive">{error}</p>}
            {showSource ? (
              <pre className="m-0 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-[11px]">
                {diagram.mermaid}
              </pre>
            ) : (
              <MermaidView source={diagram.mermaid} className="overflow-auto [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full" />
            )}
            {enlarged && (
              <Dialog open onOpenChange={(value) => !value && setEnlarged(false)}>
                <DialogContent className="max-h-[92vh] w-[92vw] max-w-[92vw] overflow-auto sm:max-w-[92vw]">
                  <DialogTitle className="sr-only">{t("Schéma de la session")}</DialogTitle>
                  <MermaidView
                    source={diagram.mermaid}
                    className="[&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-h-[82vh] [&_svg]:max-w-full"
                  />
                </DialogContent>
              </Dialog>
            )}
          </div>
        )
      }
    </Async>
  );
}
