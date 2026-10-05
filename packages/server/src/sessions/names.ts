import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Noms d'onglets retenus par session, d'un démarrage du serveur à l'autre.
 *
 * Une session garde le nom de l'onglet où elle a tourné : reprise plus tard —
 * depuis History, par `/resume` —, elle le redonne à son onglet s'il n'en a pas.
 */
export class SessionNames {
  #names: Record<string, string> = {};
  /** Écritures mises bout à bout : deux enregistrements rapprochés ne se croisent pas. */
  #saving: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {}

  /** Lit les noms retenus ; un fichier absent ou illisible n'en donne aucun. */
  async load(): Promise<void> {
    try {
      const saved: unknown = JSON.parse(await readFile(this.file, "utf8"));
      if (!saved || typeof saved !== "object" || Array.isArray(saved)) return;
      this.#names = Object.fromEntries(
        Object.entries(saved).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== ""),
      );
    } catch {
      this.#names = {};
    }
  }

  get(sessionId: string): string | undefined {
    return this.#names[sessionId];
  }

  /** Retient le nom d'une session, ou l'oublie quand il n'y en a plus. */
  set(sessionId: string, name: string | undefined): void {
    if (this.#names[sessionId] === name) return;
    if (name) this.#names[sessionId] = name;
    else if (sessionId in this.#names) delete this.#names[sessionId];
    else return;
    const text = JSON.stringify(this.#names, null, 2);
    this.#saving = this.#saving.then(() => this.#write(text)).catch(() => {
      // Dossier de données en lecture seule : les noms valent jusqu'à l'arrêt.
    });
  }

  /**
   * Accorde un onglet et la session qu'il montre : nommé, il donne son nom à la
   * session ; sans nom, il reçoit celui qu'elle a gardé, rendu ici.
   */
  match(sessionId: string, tabName: string | undefined): string | undefined {
    if (tabName) {
      this.set(sessionId, tabName);
      return undefined;
    }
    return this.get(sessionId);
  }

  /** Attend la fin des écritures en cours. */
  flush(): Promise<void> {
    return this.#saving;
  }

  async #write(text: string): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    // Écrit à côté puis renommé : une coupure en pleine écriture ne perd pas tout.
    await writeFile(`${this.file}.tmp`, text, "utf8");
    await rename(`${this.file}.tmp`, this.file);
  }
}
