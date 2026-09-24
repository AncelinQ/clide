/**
 * Adresse locale annoncée par un serveur de développement dans sa sortie :
 * `vite`, `next dev`, `astro dev`, `webpack serve` affichent tous une ligne
 * `Local: http://localhost:5173/` au démarrage.
 *
 * Seules les adresses de la machine comptent : l'aperçu s'ouvre ici, et une
 * adresse `Network:` du réseau local désigne le même serveur.
 */
const LOCAL_URL =
  /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):\d{2,5}(?:\/[^\s'"<>`]*)?/i;

/**
 * Séquences de contrôle du terminal. Un positionnement du curseur (`CSI … H`)
 * sépare deux lignes de l'écran que ConPTY redessine : il devient un saut de
 * ligne, pour ne pas coller la fin d'une ligne au début de la suivante.
 */
const CURSOR_MOVE = /\u001b\[[0-9;]*[Hf]/g;
const CONTROL = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-_]/g;

/** Texte lisible d'un flux de terminal. */
export function plainText(raw: string): string {
  return raw.replace(CURSOR_MOVE, "\n").replace(CONTROL, "");
}

/** Première adresse locale d'un texte, rendue ouvrable depuis cette machine. */
export function findDevUrl(text: string): string | undefined {
  const match = LOCAL_URL.exec(text)?.[0];
  if (!match) return undefined;
  // Ponctuation de fin de phrase, jamais celle d'une adresse.
  const trimmed = match.replace(/[.,;:!?)\]]+$/, "");
  // Un serveur qui écoute sur toutes les interfaces s'ouvre par localhost.
  return trimmed.replace(/^(https?:\/\/)(?:0\.0\.0\.0|\[::\])/i, "$1localhost");
}

/** Plus longue ligne gardée en attente de sa fin. */
const PENDING_MAX = 4096;

/**
 * Cherche l'adresse dans un flux reçu par morceaux.
 *
 * Seules les lignes complètes sont examinées : un morceau peut couper
 * `http://localhost:51` avant `73/`, et l'adresse tronquée ouvrirait un autre
 * port. La ligne en cours attend le morceau suivant.
 */
export class DevUrlScanner {
  #pending = "";
  #skipLine = false;

  push(chunk: string): string | undefined {
    let raw = this.#pending + chunk;
    if (this.#skipLine) {
      const first = raw.search(/[\r\n]/);
      if (first === -1) {
        this.#pending = raw.slice(-PENDING_MAX);
        return undefined;
      }
      raw = raw.slice(first + 1);
      this.#skipLine = false;
    }
    const end = Math.max(raw.lastIndexOf("\n"), raw.lastIndexOf("\r"));
    // La ligne en attente reste brute : une séquence de couleur coupée par le
    // morceau ne se nettoie qu'une fois complète.
    this.#pending = raw.slice(end + 1).slice(-PENDING_MAX);
    return end === -1 ? undefined : findDevUrl(plainText(raw.slice(0, end)));
  }

  /**
   * Repart d'une ligne vide. `skipLine` écarte la ligne suivante : au lancement
   * d'une commande, PSReadLine redessine la ligne tapée, et une adresse qu'on y a
   * écrite — `curl http://localhost:3000` — n'est pas une adresse annoncée.
   */
  reset(options: { skipLine?: boolean } = {}): void {
    this.#pending = "";
    this.#skipLine = options.skipLine === true;
  }
}
