import type { ListeningSocket } from "./listening.js";

/** Hôtes qu'on peut sonder : ceux de la machine, jamais le réseau. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * L'adresse répond-elle en HTML ? Un débogueur ou une API qui répond en JSON
 * écoute aussi, mais n'a pas de page à ouvrir. `undefined` quand rien n'a
 * répondu : port fermé, ou délai dépassé — une première page qui compile. Un
 * échec d'une autre sorte vient d'un serveur qui parle autre chose que HTTP, et
 * vaut `false`. Seule une adresse de la machine est sondée.
 */
export async function servesHtml(url: string): Promise<boolean | undefined> {
  const parsed = new URL(url);
  if (!/^https?:$/.test(parsed.protocol) || !LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error("seule une adresse de cette machine se sonde");
  }
  try {
    const response = await fetch(parsed, { redirect: "follow", signal: AbortSignal.timeout(3000) });
    await response.body?.cancel();
    return (response.headers.get("content-type") ?? "").includes("text/html");
  } catch (error) {
    return noAnswer(error) ? undefined : false;
  }
}

function noAnswer(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "TimeoutError") return true;
  const cause: unknown = error.cause;
  return cause instanceof Error && "code" in cause && cause.code === "ECONNREFUSED";
}

/** Réponses obtenues ou en cours, par processus et port (`pid:port`). */
const answers = new Map<string, Promise<boolean | undefined>>();

/**
 * Les serveurs qui servent une page.
 *
 * Chacun n'est sondé qu'à son apparition, et sa réponse gardée tant qu'il
 * écoute : la liste est relevée toutes les trente secondes, et chaque sonde
 * laisserait une ligne dans le journal du serveur. Un serveur qui n'a pas encore
 * répondu est sondé de nouveau au relevé suivant.
 *
 * `listening` porte tous les sockets en écoute de la machine : une réponse
 * n'est oubliée qu'une fois son serveur arrêté, quel que soit le projet qui
 * demande.
 */
export async function pageServers<T extends { pid: number; port: number; url: string }>(
  servers: readonly T[],
  listening: readonly ListeningSocket[],
): Promise<T[]> {
  const live = new Set(listening.map((socket) => `${socket.pid}:${socket.port}`));
  for (const key of answers.keys()) if (!live.has(key)) answers.delete(key);

  const html = await Promise.all(
    servers.map((server) => {
      const key = `${server.pid}:${server.port}`;
      const known = answers.get(key);
      if (known) return known;
      const answer = servesHtml(server.url);
      answers.set(key, answer);
      const forget = () => {
        if (answers.get(key) === answer) answers.delete(key);
      };
      void answer.then((value) => value === undefined && forget(), forget);
      return answer;
    }),
  );
  return servers.filter((_server, index) => html[index] === true);
}
