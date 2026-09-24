/**
 * Code OSC privé de Clide.
 *
 * Les codes voisins sont pris : 133 par FinalTerm, 633 par VS Code, 1337 par
 * iTerm2, 7770 par ClaudeTerm. En choisir un déjà utilisé ferait interpréter nos
 * marqueurs par un autre outil, ou l'inverse.
 */
export const OSC_CODE = 7771;

const ESC = "\u001b";
const BEL = "\u0007";
const ST = `${ESC}\\`;

export type ShellEvent =
  | { kind: "cwd"; path: string }
  | { kind: "command-start" }
  | { kind: "command-end"; exitCode: number }
  /** `claude` lancé dans le shell, avec sa ligne de commande. */
  | { kind: "claude-start"; command: string }
  | { kind: "claude-end" };

export interface ScanResult {
  /** Flux débarrassé des séquences que nous avons consommées. */
  text: string;
  events: ShellEvent[];
}

/**
 * Convertit l'URI émise par OSC 7 en chemin Windows.
 * `file:///C:/Projets/app` donne `C:\Projets\app`.
 */
export function uriToPath(uri: string): string | undefined {
  if (!uri.startsWith("file://")) return undefined;
  let path = decodeURIComponent(uri.slice("file://".length));
  // Un hôte peut précéder le chemin : `file://host/partage` reste un chemin UNC.
  if (path.startsWith("/") && /^\/[A-Za-z]:/.test(path)) path = path.slice(1);
  return path.replace(/\//g, "\\");
}

interface Parsed {
  /** La séquence nous est destinée : elle ne doit pas atteindre le terminal. */
  ours: boolean;
  event?: ShellEvent;
}

function parseSequence(body: string): Parsed {
  const separator = body.indexOf(";");
  if (separator === -1) return { ours: false };
  const code = Number(body.slice(0, separator));
  const payload = body.slice(separator + 1);

  if (code === 7) {
    const path = uriToPath(payload);
    return path ? { ours: true, event: { kind: "cwd", path } } : { ours: true };
  }
  if (code !== OSC_CODE) return { ours: false };

  // Un marqueur non reconnu porte quand même notre code : l'avaler plutôt que de
  // l'afficher, sinon une version plus récente du profil cracherait du texte
  // parasite dans le terminal.
  const [marker, value] = payload.split(";");
  if (marker === "START") return { ours: true, event: { kind: "command-start" } };
  // La ligne de commande peut porter des `;` : elle court jusqu'au bout.
  if (marker === "CLAUDE_START") {
    return { ours: true, event: { kind: "claude-start", command: payload.slice("CLAUDE_START;".length) } };
  }
  if (marker === "CLAUDE_END") return { ours: true, event: { kind: "claude-end" } };
  if (marker === "END") {
    const exitCode = Number(value);
    return {
      ours: true,
      event: { kind: "command-end", exitCode: Number.isFinite(exitCode) ? exitCode : 0 },
    };
  }
  return { ours: true };
}

/**
 * Extrait les marqueurs d'intégration shell d'un flux de terminal.
 *
 * Une séquence peut être coupée entre deux lectures du pseudo-terminal : le
 * début d'une séquence incomplète est retenu et ressort au prochain appel, sinon
 * un `cd` sur deux serait perdu et le morceau tronqué s'afficherait à l'écran.
 *
 * Les séquences reconnues sont retirées du flux rendu au terminal : elles sont
 * pour nous, pas pour l'affichage.
 */
export class OscScanner {
  #pending = "";

  /**
   * Au-delà de cette longueur, un fragment retenu n'est plus une séquence
   * coupée mais un `ESC ]` isolé dans des données. Le garder indéfiniment
   * retiendrait tout l'affichage qui le suit.
   */
  static readonly MAX_PENDING = 4096;

  push(chunk: string): ScanResult {
    const input = this.#pending + chunk;
    this.#pending = "";

    const events: ShellEvent[] = [];
    let out = "";
    let index = 0;

    while (index < input.length) {
      const start = input.indexOf(`${ESC}]`, index);
      if (start === -1) {
        out += input.slice(index);
        break;
      }
      out += input.slice(index, start);

      const bel = input.indexOf(BEL, start);
      const st = input.indexOf(ST, start);
      const end = bel === -1 ? st : st === -1 ? bel : Math.min(bel, st);

      if (end === -1) {
        const tail = input.slice(start);
        if (tail.length > OscScanner.MAX_PENDING) {
          out += tail;
        } else {
          // Séquence tronquée en fin de lecture : on la garde pour la suite.
          this.#pending = tail;
        }
        break;
      }

      const terminatorLength = end === st ? ST.length : BEL.length;
      const { ours, event } = parseSequence(input.slice(start + 2, end));
      if (event) events.push(event);
      if (!ours) out += input.slice(start, end + terminatorLength);

      index = end + terminatorLength;
    }

    return { text: out, events };
  }

  /** Longueur du fragment retenu, utile pour vérifier qu'il ne grossit pas indéfiniment. */
  get pendingLength(): number {
    return this.#pending.length;
  }
}
