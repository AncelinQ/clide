import { useEffect, useState } from "react";

import type { MenuItem } from "@/components/Menu";
import { t } from "@/i18n";
import { api } from "@/lib/api";
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

/** Serveurs du projet actif, tels que la zone du terminal les a relevés : la palette les ouvre sans les relever. */
let latest: DevServer[] = [];

/**
 * Serveurs de développement du projet, un par port : ceux qu'une commande des
 * onglets a annoncés, puis ceux que ses descendants font écouter sans l'avoir
 * dit — typiquement un serveur que Claude lance lui-même en arrière-plan.
 *
 * L'inventaire des processus coûte une seconde au serveur : il est relevé toutes
 * les trente secondes, juste assez pour allumer le bouton.
 */
export function useDevServers(terminals: TerminalInfo[]): DevServer[] {
  const [discovered, setDiscovered] = useState<Discovered[]>([]);
  const ids = terminals.map((info) => info.id).join(",");
  useEffect(() => {
    if (!ids) {
      setDiscovered([]);
      return;
    }
    let alive = true;
    const poll = () =>
      api<{ servers: Discovered[] }>("/api/preview/servers", { terminals: ids })
        .then((result) => alive && setDiscovered(result.servers))
        .catch(() => alive && setDiscovered([]));
    void poll();
    const timer = setInterval(poll, 30_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [ids]);

  const byPort = new Map<string, DevServer>();
  for (const info of terminals) {
    if (info.devUrl && !byPort.has(portOf(info.devUrl))) byPort.set(portOf(info.devUrl), { url: info.devUrl, label: info.title });
  }
  for (const server of discovered) {
    if (!byPort.has(String(server.port))) byPort.set(String(server.port), { url: server.url, label: shortCommand(server.command) });
  }
  latest = [...byPort.values()];
  return latest;
}

/** Ouvre l'adresse dans le navigateur de l'utilisateur : l'application de bureau la confie à Windows. */
export function openInBrowser(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

/** Ouvre le dernier serveur lancé du projet actif ; sans serveur, rien. */
export function openLatestDevServer(): void {
  const server = latest.at(-1);
  if (server) openInBrowser(server.url);
}

/** Menu des serveurs du projet : chacun s'ouvre dans le navigateur. */
export function devServerItems(servers: DevServer[]): MenuItem[] {
  if (servers.length === 0) {
    return [
      { kind: "label", label: t("Aucun serveur de développement ne tourne. Lance un script comme dev : l'adresse qu'il annonce apparaît ici.") },
    ];
  }
  return [
    { kind: "label", label: t("Ouvrir dans le navigateur") },
    ...servers.map((server): MenuItem => ({ kind: "item", label: server.url, hint: server.label, run: () => openInBrowser(server.url) })),
  ];
}
