import { ExternalLink, MonitorPlay, RotateCw, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Empty, useAsync } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { setState } from "@/state/store";
import type { TerminalInfo } from "@/lib/types";

export interface DevServer {
  url: string;
  /** Ce qui le sert : l'onglet qui l'a annoncé, ou la commande du processus qui écoute. */
  label: string;
}

/** Serveur trouvé à son port parmi les descendants des onglets. */
interface Discovered {
  url: string;
  port: number;
  command: string;
}

function portOf(url: string): string {
  try {
    return new URL(url).port;
  } catch {
    return url;
  }
}

/** Une commande se lit mieux sans ses chemins : `node …\vite.js --port 5188` devient `node vite.js --port 5188`. */
function shortCommand(command: string): string {
  const short = command.replace(/"?(?:[A-Za-z]:)?[\\/][^"\s]*[\\/]([^\\/"\s]+)"?/g, "$1").replace(/\s+/g, " ").trim();
  return short.length > 60 ? `${short.slice(0, 59)}…` : short;
}

/**
 * Serveurs de développement du projet, un par port : ceux qu'une commande des
 * onglets a annoncés, puis ceux que ses descendants font écouter sans l'avoir
 * dit — typiquement un serveur que Claude lance lui-même en arrière-plan.
 *
 * L'inventaire des processus coûte une seconde au serveur : il est relevé toutes
 * les cinq secondes aperçu ouvert, toutes les trente sinon, juste assez pour
 * allumer le bouton.
 */
export function useDevServers(root: string | undefined, terminals: TerminalInfo[], open: boolean): DevServer[] {
  const [discovered, setDiscovered] = useState<Discovered[]>([]);
  useEffect(() => {
    if (!root) return;
    let alive = true;
    const poll = () =>
      api<{ servers: Discovered[] }>("/api/preview/servers", { root })
        .then((result) => alive && setDiscovered(result.servers))
        .catch(() => alive && setDiscovered([]));
    void poll();
    const timer = setInterval(poll, open ? 5_000 : 30_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [root, open]);

  const byPort = new Map<string, DevServer>();
  for (const info of terminals) {
    if (info.devUrl && !byPort.has(portOf(info.devUrl))) byPort.set(portOf(info.devUrl), { url: info.devUrl, label: info.title });
  }
  for (const server of discovered) {
    if (!byPort.has(String(server.port))) byPort.set(String(server.port), { url: server.url, label: shortCommand(server.command) });
  }
  return [...byPort.values()];
}

/**
 * Le rendu d'un serveur de développement, à côté du terminal. Rien à configurer :
 * les adresses viennent de `useDevServers`, et l'aperçu se vide quand le serveur
 * s'arrête.
 */
export function DevPreview({ servers }: { servers: DevServer[] }) {
  const [picked, setPicked] = useState<string>();
  const [reloads, setReloads] = useState(0);
  // Le dernier serveur lancé, tant qu'on n'en a pas choisi un qui tourne encore.
  const url = servers.find((server) => server.url === picked)?.url ?? servers.at(-1)?.url;
  // Un cadre refusé ne s'annonce pas à la page qui le contient : le serveur lit
  // les en-têtes à sa place. Faute de réponse, le cadre est tenté.
  const probe = useAsync(
    () => (url ? api<{ reachable: boolean; framable: boolean }>("/api/preview/probe", { url }) : Promise.resolve(undefined)),
    [url, reloads],
  );
  const refused = probe.data?.framable === false;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border bg-background">
      <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1">
        <MonitorPlay className="size-3.5 shrink-0 text-muted-foreground" />
        {servers.length > 1 && url ? (
          <Select value={url} onValueChange={setPicked}>
            <SelectTrigger className="h-6 w-full min-w-0 flex-1 font-mono text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {servers.map((server) => (
                <SelectItem key={server.url} value={server.url} className="font-mono text-[11px]">
                  {server.url} <span className="text-muted-foreground">· {server.label}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span
            className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground"
            title={servers.find((server) => server.url === url)?.label ?? url}
          >
            {url ?? t("Aperçu")}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          disabled={!url}
          title={t("Recharger")}
          onClick={() => setReloads((value) => value + 1)}
        >
          <RotateCw />
        </Button>
        {url && (
          <Button variant="ghost" size="icon" className="size-6" title={t("Ouvrir dans le navigateur")} asChild>
            <a href={url} target="_blank" rel="noreferrer">
              <ExternalLink />
            </a>
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          title={t("Fermer l'aperçu")}
          onClick={() => setState({ previewOpen: false })}
        >
          <X />
        </Button>
      </div>
      {url && refused ? (
        <div className="grid flex-1 place-content-center justify-items-center gap-2 p-4">
          <Empty icon={MonitorPlay}>
            {t("Ce serveur refuse d'être affiché dans un cadre (X-Frame-Options ou frame-ancestors).")}
          </Empty>
          <Button variant="outline" size="sm" asChild>
            <a href={url} target="_blank" rel="noreferrer">
              <ExternalLink /> {t("Ouvrir dans le navigateur")}
            </a>
          </Button>
        </div>
      ) : url ? (
        <iframe key={`${url}|${reloads}`} src={url} title={t("Aperçu")} className="min-h-0 flex-1 border-0 bg-white" />
      ) : (
        <Empty icon={MonitorPlay}>
          {t("Aucun serveur de développement ne tourne. Lance un script comme dev : l'adresse qu'il annonce s'ouvre ici.")}
        </Empty>
      )}
    </div>
  );
}
