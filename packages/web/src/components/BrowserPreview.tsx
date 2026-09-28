import { Bot, Globe, Plug, Power, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type WheelEvent } from "react";

import { Empty } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { t } from "@/i18n";
import type { BrowserFrame } from "@/lib/types";
import {
  browserAction,
  connectBrowserMcp,
  loadBrowser,
  navigateBrowser,
  selectBrowserPage,
  sendBrowserInput,
  watchBrowser,
  type BrowserInfo,
} from "@/state/browser";
import { getState, setState, useStore } from "@/state/store";

/** Touches relayées telles quelles à la page ; les autres passent comme texte tapé. */
const RELAYED_KEYS = new Set(["Enter", "Backspace", "Tab", "Escape", "Delete", "ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

type McpKind = "chrome-devtools" | "playwright";

const MCP_LABEL: Record<McpKind, string> = { "chrome-devtools": "chrome-devtools-mcp", playwright: "Playwright MCP" };

/** Ligne de commande équivalente, montrée avant de l'exécuter : elle change la configuration de Claude Code. */
function mcpCommand(info: BrowserInfo, kind: McpKind): string {
  return `claude mcp add-json -s local ${info.mcp.name} '${JSON.stringify({ type: "stdio", ...info.mcp.configs[kind] })}'`;
}

/** Bascule de l'aperçu entre les serveurs de développement et le navigateur de Claude. */
export function PreviewSourceSwitch() {
  const source = useStore((state) => state.previewSource);
  return (
    <Button
      variant="ghost"
      size="icon"
      className={source === "browser" ? "size-6 bg-accent text-primary" : "size-6"}
      title={source === "browser" ? t("Revenir aux serveurs de développement") : t("Voir le navigateur de Claude")}
      aria-pressed={source === "browser"}
      onClick={() => setState({ previewSource: source === "browser" ? "servers" : "browser" })}
    >
      <Bot />
    </Button>
  );
}

/**
 * Le navigateur que Claude pilote par son MCP, en direct : Clide le lance sans
 * fenêtre, Claude s'y branche, et l'aperçu montre sa page. Un clic, la molette ou
 * la frappe sur l'image vont à la page, pour reprendre la main.
 */
export function BrowserPreview() {
  const state = useStore((store) => store.browser);
  const root = useStore((store) => store.activeRoot);
  const [info, setInfo] = useState<BrowserInfo>();
  const [frame, setFrame] = useState<BrowserFrame>();
  const [error, setError] = useState<string>();
  const [address, setAddress] = useState("");
  const [wiring, setWiring] = useState(false);
  const [wired, setWired] = useState<string>();
  const image = useRef<HTMLImageElement>(null);

  useEffect(() => {
    loadBrowser()
      .then(setInfo)
      .catch((caught: unknown) => setError((caught as Error).message));
  }, []);

  const running = state?.status === "running";
  useEffect(() => {
    if (!running) {
      setFrame(undefined);
      return;
    }
    return watchBrowser(setFrame);
  }, [running]);

  const page = state?.pages.find((item) => item.id === state.current);
  useEffect(() => {
    setAddress(page?.url === "about:blank" ? "" : (page?.url ?? ""));
  }, [page?.url]);

  const act = (run: () => Promise<unknown>) => {
    setError(undefined);
    run().catch((caught: unknown) => setError((caught as Error).message));
  };

  /** Point de l'image en pixels CSS de la page : l'image peut être réduite pour tenir. */
  const pointOf = (event: MouseEvent | WheelEvent) => {
    const box = image.current?.getBoundingClientRect();
    if (!box || !frame) return undefined;
    return {
      x: Math.round(((event.clientX - box.left) / box.width) * frame.width),
      y: Math.round(((event.clientY - box.top) / box.height) * frame.height),
    };
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (RELAYED_KEYS.has(event.key)) {
      event.preventDefault();
      act(() => sendBrowserInput({ kind: "key", key: event.key }));
    } else if (event.key.length === 1) {
      event.preventDefault();
      act(() => sendBrowserInput({ kind: "text", text: event.key }));
    }
  };

  const wire = (kind: McpKind) => {
    if (!root) return;
    setWired(undefined);
    act(async () => {
      const result = await connectBrowserMcp(root, kind);
      setWired(result.output || t("Déclaré. Les sessions Claude lancées dans ce projet à partir de maintenant l'auront."));
    });
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-background" data-browser-preview>
      <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1">
        <Bot className="size-3.5 shrink-0 text-muted-foreground" />
        {running && state && state.pages.length > 1 && state.current ? (
          <Select value={state.current} onValueChange={(id) => act(() => selectBrowserPage(id))}>
            <SelectTrigger className="h-6 w-32 shrink-0 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {state.pages.map((item) => (
                <SelectItem key={item.id} value={item.id} className="text-[11px]">
                  {item.title || item.url}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {running ? (
          <form
            className="min-w-0 flex-1"
            onSubmit={(event) => {
              event.preventDefault();
              if (address.trim()) act(() => navigateBrowser(address.trim()));
            }}
          >
            <Input
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder={t("Adresse")}
              spellCheck={false}
              className="h-6 font-mono text-[11px]"
              data-browser-address
            />
          </form>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{t("Navigateur de Claude")}</span>
        )}
        <Button
          variant="ghost"
          size="icon"
          className={wiring ? "size-6 bg-accent text-primary" : "size-6"}
          title={t("Brancher Claude sur ce navigateur")}
          onClick={() => setWiring((value) => !value)}
        >
          <Plug />
        </Button>
        {running && (
          <Button variant="ghost" size="icon" className="size-6" title={t("Arrêter le navigateur")} onClick={() => act(() => browserAction("stop"))}>
            <Power />
          </Button>
        )}
        <PreviewSourceSwitch />
        <Button variant="ghost" size="icon" className="size-6" title={t("Fermer l'aperçu")} onClick={() => setState({ previewOpen: false })}>
          <X />
        </Button>
      </div>

      {wiring && info && (
        <div className="grid shrink-0 grid-cols-1 gap-1.5 border-b px-3 py-2 text-[11px]">
          <p className="text-muted-foreground">
            {t(
              "Déclare pour ce projet, en portée locale (à toi seul, rien dans le dépôt), un serveur MCP « {name} » branché sur ce navigateur. Claude doit ensuite utiliser ses outils, pas ceux d'un autre MCP navigateur.",
              { name: info.mcp.name },
            )}
          </p>
          {(["chrome-devtools", "playwright"] as const).map((kind) => (
            <div key={kind} className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[10.5px]" title={mcpCommand(info, kind)}>
                {mcpCommand(info, kind)}
              </code>
              <Button size="sm" variant="outline" className="h-6 shrink-0 text-[11px]" disabled={!root} onClick={() => wire(kind)}>
                {MCP_LABEL[kind]}
              </Button>
            </div>
          ))}
          {wired && <p className="text-emerald-600 dark:text-emerald-400">{wired}</p>}
        </div>
      )}

      {error && <p className="shrink-0 px-3 py-1.5 text-[11px] text-destructive">{error}</p>}

      {!running ? (
        <div className="grid flex-1 place-content-center justify-items-center gap-2 p-4">
          <Empty icon={Globe}>
            {state?.status === "error"
              ? t("Le navigateur n'a pas démarré : {error}", { error: state.error ?? "" })
              : t("Un Chrome sans fenêtre, que le MCP navigateur de Claude pilote et que l'aperçu montre en direct. Son profil est à part : ni tes cookies ni tes sessions.")}
          </Empty>
          <Button size="sm" disabled={state?.status === "starting"} onClick={() => act(() => browserAction("start"))} data-browser-start>
            <Power /> {state?.status === "starting" ? t("Démarrage…") : t("Lancer le navigateur")}
          </Button>
        </div>
      ) : frame ? (
        <div
          tabIndex={0}
          className="grid min-h-0 flex-1 place-items-center overflow-hidden bg-muted/40 outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onKeyDown={onKeyDown}
          onPaste={(event) => {
            const text = event.clipboardData.getData("text");
            if (!text) return;
            event.preventDefault();
            act(() => sendBrowserInput({ kind: "text", text }));
          }}
          title={t("Clics, molette et frappe vont à la page")}
        >
          <img
            ref={image}
            alt={page?.title ?? t("Navigateur de Claude")}
            src={`data:image/jpeg;base64,${frame.data}`}
            draggable={false}
            className="block max-h-full max-w-full cursor-default select-none"
            data-browser-frame
            onMouseDown={(event) => {
              event.preventDefault();
              (event.currentTarget.parentElement as HTMLElement | null)?.focus();
            }}
            onClick={(event) => {
              const point = pointOf(event);
              if (point) act(() => sendBrowserInput({ kind: "click", ...point }));
            }}
            onWheel={(event) => {
              const point = pointOf(event);
              if (point) act(() => sendBrowserInput({ kind: "wheel", ...point, deltaX: event.deltaX, deltaY: event.deltaY }));
            }}
          />
        </div>
      ) : (
        <p className="flex-1 p-4 text-center text-[11px] text-muted-foreground">{t("En attente de la première image…")}</p>
      )}
    </div>
  );
}

/** Ouvre l'aperçu sur le navigateur de Claude, et le lance s'il ne tourne pas. */
export function showClaudeBrowser(): void {
  setState({ previewOpen: true, previewSource: "browser" });
  if (getState().browser?.status !== "running") void browserAction("start").catch(() => undefined);
}
