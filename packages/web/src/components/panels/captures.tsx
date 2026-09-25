import { Images } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Async, Empty, useAsync } from "@/components/common";
import { useNewestFirst } from "@/components/ModeBlock";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { t } from "@/i18n";
import { api, formatDate } from "@/lib/api";
import { setState } from "@/state/store";
import type { ShownSession } from "@/components/panels/session";

interface Image {
  mediaType: string;
  data: string;
}

interface GalleryItem {
  agentId?: string;
  agentLabel?: string;
  index: number;
  kind: "tool" | "prompt";
  at?: string;
  label?: string;
  text: string;
  images: number;
}

/** Vrai dès que l'élément approche de la zone visible, et le reste. */
function useSeen<T extends Element>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || seen) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [seen]);
  return [ref, seen] as const;
}

/**
 * Images d'une entrée de l'activité, en vignettes ; un clic les montre en grand.
 *
 * Une capture pèse souvent des centaines de Ko en base64 : elles ne se chargent
 * qu'en approchant de l'écran, pour qu'une longue session reste légère à ouvrir.
 */
export function Thumbnails({
  sessionId,
  agentId,
  index,
  count,
}: {
  sessionId: string;
  agentId?: string;
  index: number;
  count: number;
}) {
  const [ref, seen] = useSeen<HTMLDivElement>();
  const [images, setImages] = useState<Image[]>();
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState<Image>();

  useEffect(() => {
    if (!seen || images) return;
    api<{ images: Image[] }>("/api/session/images", {
      id: sessionId,
      index,
      ...(agentId ? { agent: agentId } : {}),
    })
      .then((result) => setImages(result.images))
      .catch((caught: Error) => setError(caught.message));
  }, [seen, images, sessionId, agentId, index]);

  return (
    <div ref={ref} className="mt-1 flex flex-wrap gap-1.5">
      {error && <span className="text-[11px] text-destructive">{error}</span>}
      {!images &&
        !error &&
        Array.from({ length: count }, (_, position) => (
          <div key={position} className="h-24 w-40 animate-pulse rounded-md border bg-muted/40" />
        ))}
      {images?.map((image, position) => (
        <button
          key={position}
          type="button"
          className="overflow-hidden rounded-md border hover:ring-2 hover:ring-primary/40"
          onClick={() => setOpen(image)}
        >
          <img
            src={`data:${image.mediaType};base64,${image.data}`}
            alt={t("capture {n}", { n: position + 1 })}
            className="h-24 max-w-64 object-contain"
          />
        </button>
      ))}
      {open && (
        <Dialog open onOpenChange={(value) => !value && setOpen(undefined)}>
          <DialogContent className="max-h-[92vh] w-max max-w-[92vw] sm:max-w-[92vw]">
            <DialogTitle className="sr-only">{t("Capture")}</DialogTitle>
            <img
              src={`data:${open.mediaType};base64,${open.data}`}
              alt={t("Capture")}
              className="max-h-[84vh] max-w-full object-contain"
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/**
 * Les images d'une session dans l'ordre du temps, sous-agents compris : les
 * captures que Claude a prises en travaillant, et celles qu'on lui a collées.
 * Chacune s'ouvre à sa place dans l'activité.
 */
export function CapturesPanel({ session }: { session: ShownSession }) {
  const state = useAsync(
    () => api<{ items: GalleryItem[] }>("/api/session/gallery", { id: session.sessionId }),
    [session.sessionId],
    session.refresh,
  );

  const newest = useNewestFirst("captures");

  const reveal = (item: GalleryItem) =>
    setState({
      sessionMode: "activity",
      activityAgents: item.agentId
        ? { sessionId: session.sessionId, path: [{ agentId: item.agentId, label: item.agentLabel ?? item.agentId }] }
        : null,
      activityFocus: {
        sessionId: session.sessionId,
        index: item.index,
        ...(item.agentId ? { agentId: item.agentId } : {}),
      },
    });

  return (
    <Async state={state}>
      {({ items }) =>
        items.length === 0 ? (
          <Empty icon={Images}>{t("Aucune image dans cette session.")}</Empty>
        ) : (
          <ul className="m-0 list-none p-0">
            {(newest ? [...items].reverse() : items).map((item) => (
              <li key={`${item.agentId ?? ""}|${item.index}`} className="border-b py-2 last:border-0">
                <button
                  type="button"
                  className="flex w-full min-w-0 items-baseline gap-2 text-left text-[11px] text-muted-foreground hover:text-foreground"
                  title={t("Ouvrir dans l'activité")}
                  onClick={() => reveal(item)}
                >
                  <span className="shrink-0 tabular-nums">{formatDate(item.at)}</span>
                  <span className="w-16 shrink-0 truncate tracking-wide uppercase">{item.label ?? t("moi")}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {item.agentLabel ? `${item.agentLabel} › ` : ""}
                    {item.text}
                  </span>
                </button>
                <Thumbnails
                  sessionId={session.sessionId}
                  index={item.index}
                  count={item.images}
                  {...(item.agentId ? { agentId: item.agentId } : {})}
                />
              </li>
            ))}
          </ul>
        )
      }
    </Async>
  );
}
