import { ExternalLink, MonitorPlay, RotateCw, X } from "lucide-react";
import { useState } from "react";

import { Empty, useAsync } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { setState } from "@/state/store";
import type { TerminalInfo } from "@/lib/types";

/** Serveurs de développement que font tourner les onglets du projet, un par adresse. */
export function devServers(terminals: TerminalInfo[]): { url: string; title: string }[] {
  const seen = new Map<string, string>();
  for (const info of terminals) {
    if (info.devUrl && !seen.has(info.devUrl)) seen.set(info.devUrl, info.title);
  }
  return [...seen].map(([url, title]) => ({ url, title }));
}

/**
 * Le rendu d'un serveur de développement, à côté du terminal.
 *
 * L'adresse est celle qu'une commande du shell a annoncée en démarrant, lue par
 * le serveur dans la sortie de l'onglet : rien à configurer. Elle disparaît quand
 * la commande se termine, et l'aperçu avec elle.
 */
export function DevPreview({ terminals }: { terminals: TerminalInfo[] }) {
  const servers = devServers(terminals);
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
            <SelectTrigger className="h-6 min-w-0 flex-1 font-mono text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {servers.map((server) => (
                <SelectItem key={server.url} value={server.url} className="font-mono text-[11px]">
                  {server.url}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground" title={url}>
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
