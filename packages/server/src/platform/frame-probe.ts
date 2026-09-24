/** Hôtes que l'aperçu peut sonder : ceux de la machine, jamais le réseau. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export interface FrameProbe {
  /** Le serveur a répondu. Faux pendant qu'il démarre encore, ou s'il est arrêté. */
  reachable: boolean;
  /** Le serveur accepte d'être affiché dans un cadre venu d'une autre origine. */
  framable: boolean;
  /** La page est du HTML : un débogueur ou une API qui répond en JSON n'a rien à montrer. */
  html: boolean;
}

/**
 * Ce que disent les en-têtes d'une page sur son affichage en cadre.
 *
 * L'aperçu vit sur une autre origine que le serveur de développement : un
 * `X-Frame-Options`, quelle que soit sa valeur, le refuse, et un `frame-ancestors`
 * aussi, sauf s'il admet toute origine.
 */
export function framableFrom(headers: Headers): boolean {
  if (headers.get("x-frame-options")) return false;
  const policy = headers.get("content-security-policy") ?? "";
  const ancestors = /(?:^|;)\s*frame-ancestors\s+([^;]*)/i.exec(policy)?.[1]?.trim().split(/\s+/);
  return !ancestors || ancestors.includes("*");
}

/**
 * Sonde l'adresse d'un serveur de développement.
 *
 * Un cadre refusé ne se voit pas depuis la page — le navigateur n'en dit rien à
 * une autre origine — : c'est le serveur de l'application qui lit les en-têtes.
 * Seule une adresse de la machine est sondée.
 */
export async function probeFrame(url: string): Promise<FrameProbe> {
  const parsed = new URL(url);
  if (!/^https?:$/.test(parsed.protocol) || !LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error("seule une adresse de cette machine s'ouvre dans l'aperçu");
  }
  try {
    const response = await fetch(parsed, { redirect: "follow", signal: AbortSignal.timeout(3000) });
    await response.body?.cancel();
    return {
      reachable: true,
      framable: framableFrom(response.headers),
      html: (response.headers.get("content-type") ?? "").includes("text/html"),
    };
  } catch {
    return { reachable: false, framable: true, html: false };
  }
}
