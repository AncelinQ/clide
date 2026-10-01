/** Hôtes qu'on peut sonder : ceux de la machine, jamais le réseau. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * L'adresse répond-elle en HTML ? Un débogueur ou une API qui répond en JSON
 * écoute aussi, mais n'a pas de page à ouvrir. Un serveur qui ne répond pas
 * encore, ou plus, vaut `false`. Seule une adresse de la machine est sondée.
 */
export async function servesHtml(url: string): Promise<boolean> {
  const parsed = new URL(url);
  if (!/^https?:$/.test(parsed.protocol) || !LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error("seule une adresse de cette machine se sonde");
  }
  try {
    const response = await fetch(parsed, { redirect: "follow", signal: AbortSignal.timeout(3000) });
    await response.body?.cancel();
    return (response.headers.get("content-type") ?? "").includes("text/html");
  } catch {
    return false;
  }
}
