import { Async, useAsync } from "@/components/common";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { t } from "@/i18n";
import { api, shortName } from "@/lib/api";
import type { FilePreview } from "@/lib/types";

function formatSize(bytes: number): string {
  if (bytes < 1024) return t("{size} o", { size: bytes });
  if (bytes < 1024 * 1024) return t("{size} Ko", { size: (bytes / 1024).toFixed(1) });
  return t("{size} Mo", { size: (bytes / 1024 / 1024).toFixed(1) });
}

function Body({ preview }: { preview: FilePreview }) {
  switch (preview.kind) {
    case "text":
      return (
        <>
          <pre className="m-0 max-h-[65vh] overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-[12px] leading-relaxed whitespace-pre">
            {preview.text}
          </pre>
          {preview.truncated && (
            <p className="text-[11px] text-muted-foreground">{t("Tronqué : seul le début du fichier est montré.")}</p>
          )}
        </>
      );
    case "image":
      return (
        <div className="flex max-h-[65vh] justify-center overflow-auto rounded-md border bg-muted/40 p-3">
          <img
            src={`data:${preview.mime};base64,${preview.base64}`}
            alt={shortName(preview.path)}
            className="max-w-full object-contain"
          />
        </div>
      );
    case "binary":
      return <p className="text-muted-foreground">{t("Fichier binaire, sans aperçu.")}</p>;
    case "too-large":
      return <p className="text-muted-foreground">{t("Image trop lourde pour l'aperçu.")}</p>;
  }
}

function Loaded({ root, path }: { root: string; path: string }) {
  const state = useAsync(() => api<FilePreview>("/api/files/preview", { root, path }), [root, path]);
  return (
    <Async state={state}>
      {(preview) => (
        <>
          <DialogHeader>
            <DialogTitle className="truncate">{shortName(preview.path)}</DialogTitle>
            <DialogDescription className="truncate" title={preview.path}>
              {formatSize(preview.size)} · {preview.path}
            </DialogDescription>
          </DialogHeader>
          <Body preview={preview} />
        </>
      )}
    </Async>
  );
}

/** Aperçu rapide d'un fichier, sans quitter l'application ni ouvrir d'éditeur. */
export function FilePreviewDialog({
  root,
  path,
  onClose,
}: {
  root: string;
  path: string | undefined;
  onClose: () => void;
}) {
  return (
    <Dialog open={path !== undefined} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">{path && <Loaded root={root} path={path} />}</DialogContent>
    </Dialog>
  );
}
