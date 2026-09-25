import { SquareTerminal } from "lucide-react";
import { useEffect, useState } from "react";

import { Markdown } from "@/components/Markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { t } from "@/i18n";
import { api, formatDate } from "@/lib/api";
import type { ActivityEntry } from "@/lib/types";
import { useStore } from "@/state/store";
import { revealInTerminal, type RevealOutcome } from "@/state/terminals";

type ActivityDetail =
  | { kind: "prompt" | "command" | "answer" | "note"; text: string }
  | { kind: "tool"; name: string; input?: Record<string, unknown>; result?: string; failed?: boolean };

const KIND_LABEL: Record<ActivityEntry["kind"], string> = {
  prompt: "Prompt",
  command: "Commande",
  answer: "Réponse de Claude",
  tool: "Appel d'outil",
  note: "Note",
};

/** Première ligne parlante d'un texte, débarrassée des marques de markdown que le terminal n'affiche pas. */
function firstLine(text: string, max: number): string {
  const line =
    text
      .split(/\r?\n/)
      .map((value) => value.replace(/^[\s>#*\-+`|]+/, "").replace(/[*_`]/g, "").trim())
      .find((value) => value.length >= 3) ?? "";
  return line.slice(0, max);
}

/**
 * Textes qui retrouvent l'entrée dans le terminal, du plus précis au plus lâche.
 * Claude Code affiche un appel d'outil comme `Bash(ls -la)` ; un outil MCP sous
 * un autre nom, d'où le résumé seul en second recours.
 */
export function needlesOf(entry: ActivityEntry): string[] {
  if (entry.kind === "tool") {
    const summary = entry.summary.slice(0, 30);
    return [`${entry.name}(${summary.slice(0, 20)}`, summary];
  }
  return [firstLine(entry.text, 50)];
}

/** Rang de l'entrée parmi celles qui se cherchent pareil, compté depuis la fin. */
function occurrenceFromEnd(entries: ActivityEntry[], index: number): number {
  const needle = needlesOf(entries[index]!)[0];
  return entries.slice(index + 1).filter((entry) => needlesOf(entry)[0] === needle).length;
}

const REVEAL_MESSAGE: Record<Exclude<RevealOutcome, "found">, string> = {
  fullscreen:
    "Claude Code est en mode plein écran : il dessine lui-même l'écran, sans historique où chercher. Passe l'interface sur « default » dans Réglages, puis relance l'onglet.",
  missing: "Introuvable dans le terminal : l'entrée n'y est plus affichée (session reprise, /clear, compactage) ou son rendu diffère trop.",
  absent: "Le terminal de cette session n'est pas ouvert.",
};

/**
 * Une ligne de l'activité en entier, et de quoi la retrouver dans le terminal.
 *
 * Le saut ne vaut que pour la session d'un onglet ouvert, hors sous-agent — le
 * terminal ne montre pas le détail d'un sous-agent —, et hors du mode plein écran.
 */
export function ActivityDetailDialog({
  sessionId,
  agentId,
  entries,
  index,
  offset,
  onClose,
}: {
  sessionId: string;
  agentId?: string;
  /** Entrées affichées, pour situer celle-ci parmi ses semblables. */
  entries: ActivityEntry[];
  /** Rang de l'entrée dans `entries`. */
  index: number;
  /** Rang de la première entrée affichée dans la session. */
  offset: number;
  onClose: () => void;
}) {
  const entry = entries[index]!;
  const [detail, setDetail] = useState<ActivityDetail>();
  const [error, setError] = useState<string>();
  const [reveal, setReveal] = useState<RevealOutcome>();
  const terminalId = useStore(
    (state) => Object.entries(state.live).find(([, live]) => live.sessionId === sessionId)?.[0],
  );

  useEffect(() => {
    api<{ detail: ActivityDetail }>("/api/session/activity/entry", {
      id: sessionId,
      index: offset + index,
      ...(agentId ? { agent: agentId } : {}),
    })
      .then((result) => setDetail(result.detail))
      .catch((caught: Error) => setError(caught.message));
  }, [sessionId, agentId, offset, index]);

  const goToTerminal = () => {
    if (!terminalId) return;
    const outcome = revealInTerminal(terminalId, needlesOf(entry), occurrenceFromEnd(entries, index));
    setReveal(outcome);
    if (outcome === "found") onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[88vh] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {t(KIND_LABEL[entry.kind])}
            {entry.kind === "tool" && <Badge variant="secondary">{entry.name}</Badge>}
            {entry.kind === "tool" && entry.failed && <Badge variant="destructive">{t("échec")}</Badge>}
          </DialogTitle>
          <DialogDescription>{entry.at ? formatDate(entry.at) : ""}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto">
          {error && <p className="text-destructive">{error}</p>}
          {!detail && !error && <p className="text-muted-foreground">{t("chargement…")}</p>}
          {detail && detail.kind === "tool" && (
            <div className="grid gap-3">
              <section className="grid gap-1">
                <div className="text-[11px] font-medium text-muted-foreground">{t("Entrée")}</div>
                <pre className="max-h-64 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-[11.5px] whitespace-pre-wrap">
                  {typeof detail.input?.["command"] === "string"
                    ? detail.input["command"]
                    : JSON.stringify(detail.input ?? {}, null, 2)}
                </pre>
              </section>
              <section className="grid gap-1">
                <div className="text-[11px] font-medium text-muted-foreground">{t("Résultat")}</div>
                {detail.result ? (
                  <pre className="max-h-80 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-[11.5px] whitespace-pre-wrap">
                    {detail.result}
                  </pre>
                ) : (
                  <p className="text-[12px] text-muted-foreground">{t("Aucun résultat textuel.")}</p>
                )}
              </section>
            </div>
          )}
          {detail && detail.kind === "answer" && <Markdown text={detail.text} />}
          {detail && detail.kind !== "tool" && detail.kind !== "answer" && (
            <p className="text-[12.5px] break-words whitespace-pre-wrap">{detail.text}</p>
          )}
        </div>

        {reveal && reveal !== "found" && <p className="text-[12px] text-destructive">{t(REVEAL_MESSAGE[reveal])}</p>}
        <DialogFooter>
          {!agentId && (
            <Button
              variant="outline"
              disabled={!terminalId}
              title={terminalId ? undefined : t(REVEAL_MESSAGE.absent)}
              onClick={goToTerminal}
            >
              <SquareTerminal /> {t("Voir dans le terminal")}
            </Button>
          )}
          <Button onClick={onClose}>{t("Fermer")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
