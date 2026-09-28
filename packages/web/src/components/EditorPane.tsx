import { Columns2, Eye, FileCode } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Markdown } from "@/components/Markdown";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { cn } from "cn";
import { mountEditor, reloadFile, saveFile, watchText } from "@/state/editor";
import { useStore } from "@/state/store";

type MarkdownMode = "code" | "split" | "preview";

/** Mode choisi pour les fichiers Markdown, gardé le temps de la page. */
let lastMarkdownMode: MarkdownMode = "split";

/** Aperçu d'un Markdown, rendu sans HTML brut comme le plan de session. */
function MarkdownPreview({ path }: { path: string }) {
  const [text, setText] = useState("");
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // L'aperçu suit la frappe après une courte pause : le rendre à chaque touche saccaderait la saisie.
    const stop = watchText(path, (value) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setText(value), 120);
    });
    return () => {
      if (timer) clearTimeout(timer);
      stop();
    };
  }, [path]);
  return (
    <div className="h-full overflow-auto px-5 py-4 text-[13px]">
      <Markdown text={text} />
    </div>
  );
}

/** Hôte de l'éditeur Monaco : il ne crée rien, il prête son nœud à l'instance unique. */
function CodeHost({ path }: { path: string }) {
  const host = useRef<HTMLDivElement>(null);
  const kind = useStore((state) => state.files[path]?.kind);
  useEffect(() => {
    if (host.current && kind === "text") void mountEditor(host.current, path);
  }, [path, kind]);
  return <div ref={host} className="h-full min-h-0 w-full min-w-0" />;
}

/** Un fichier ouvert au centre : son texte, son aperçu, ou son image, et ce qui demande un choix. */
export function EditorPane({ path }: { path: string }) {
  const file = useStore((state) => state.files[path]);
  const markdown = /\.(md|markdown|mdx)$/i.test(path);
  const [mode, setMode] = useState<MarkdownMode>(lastMarkdownMode);
  const pick = (next: MarkdownMode) => {
    lastMarkdownMode = next;
    setMode(next);
  };

  if (!file || file.kind === "loading") {
    return <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">{t("Ouverture…")}</div>;
  }
  if (file.kind === "unsupported") {
    return <div className="flex h-full items-center justify-center p-4 text-[12px] text-destructive">{file.error}</div>;
  }
  if (file.kind === "image") {
    return (
      <div className="flex h-full items-center justify-center overflow-auto bg-[repeating-conic-gradient(var(--muted)_0%_25%,transparent_0%_50%)] bg-[length:16px_16px] p-4">
        <img src={file.src} alt="" className="max-h-full max-w-full object-contain" />
      </div>
    );
  }

  const showCode = !markdown || mode !== "preview";
  const showPreview = markdown && mode !== "code";
  return (
    <div className="flex h-full min-h-0 flex-col">
      {file.changedOnDisk && (
        <div className="flex shrink-0 items-center gap-2 border-b bg-amber-500/10 px-3 py-1.5 text-[12px]">
          <span className="flex-1">{t("Ce fichier a changé sur disque pendant que vous le modifiiez.")}</span>
          <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={() => void reloadFile(path)}>
            {t("Recharger")}
          </Button>
          <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => void saveFile(path, { overwrite: true })}>
            {t("Écraser")}
          </Button>
        </div>
      )}
      {file.error && !file.changedOnDisk && (
        <div className="shrink-0 border-b bg-destructive/10 px-3 py-1.5 text-[12px] text-destructive">{file.error}</div>
      )}
      <div className="relative flex min-h-0 flex-1">
        {showCode && (
          <div className={cn("min-h-0 min-w-0", showPreview ? "w-1/2 border-r" : "flex-1")}>
            <CodeHost path={path} />
          </div>
        )}
        {showPreview && (
          <div className={cn("min-h-0 min-w-0", showCode ? "w-1/2" : "flex-1")}>
            <MarkdownPreview path={path} />
          </div>
        )}
        {markdown && (
          <div className="absolute top-2 right-4 z-10 flex gap-0.5 rounded-md border bg-card p-0.5 shadow-sm">
            {(
              [
                ["code", FileCode, "Code"],
                ["split", Columns2, "Côte à côte"],
                ["preview", Eye, "Aperçu"],
              ] as const
            ).map(([id, Icon, label]) => (
              <Button
                key={id}
                variant="ghost"
                size="icon"
                className={cn("size-6", mode === id && "bg-accent text-primary")}
                title={t(label)}
                onClick={() => pick(id)}
              >
                <Icon className="size-3.5" />
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
