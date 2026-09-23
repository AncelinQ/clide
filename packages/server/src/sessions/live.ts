import {
  TranscriptReader,
  claudeHome,
  findLiveTranscript,
  resumedSessionId,
  sessionCost,
  type Calibration,
  type CostState,
  type SessionCost,
  type TokenUsage,
} from "@claude-ide/core";

/** Ce que le client montre de la session qui tourne dans un onglet. */
export interface LiveSession {
  sessionId: string;
  title?: string;
  permissionMode?: string;
  planMode?: boolean;
  tokens?: TokenUsage;
  cost?: CostState;
  /** Coût de la session : exact, estimé à partir des tarifs déduits, ou inconnu. */
  price?: SessionCost;
  lastActivityAt?: string;
}

interface Tracked {
  cwd: string;
  since: number;
  /** Session nommée par `claude --resume`, quand l'onglet en reprend une. */
  resumed?: string;
  reader?: TranscriptReader;
  path?: string;
  /** Dernier état envoyé, pour ne prévenir qu'en cas de changement. */
  sent?: string;
}

/**
 * Relie chaque onglet Claude à la session qui y tourne, et la suit.
 *
 * Le rattachement vient des hooks quand ils sont installés — ils donnent
 * exactement la session et son transcript —, sinon de la recherche du transcript
 * créé ou repris depuis l'ouverture de l'onglet. Une fois rattachée, la session
 * est lue par ajouts : un `poll` ne coûte que ce qui a été écrit depuis le
 * précédent.
 */
export class LiveSessions {
  readonly #tracked = new Map<string, Tracked>();
  readonly #listeners = new Set<(terminalId: string, session: LiveSession) => void>();
  #timer: NodeJS.Timeout | undefined;
  #running: Promise<void> | undefined;
  #pricing: () => Map<string, Calibration> = () => new Map();

  constructor(
    private readonly home: string = claudeHome(),
    private readonly intervalMs = 1500,
  ) {}

  /** Source des tarifs déduits, pour chiffrer une session qui n'a pas encore de relevé. */
  usePricing(pricing: () => Map<string, Calibration>): void {
    this.#pricing = pricing;
  }

  on(listener: (terminalId: string, session: LiveSession) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  start(): void {
    this.#timer = setInterval(() => void this.tick(), this.intervalMs);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
    this.#listeners.clear();
  }

  /** Commence à chercher la session d'un onglet Claude qui vient de s'ouvrir. */
  track(terminalId: string, cwd: string, command?: string, since: number = Date.now()): void {
    if (this.#tracked.has(terminalId)) return;
    const resumed = resumedSessionId(command);
    this.#tracked.set(terminalId, { cwd, since, ...(resumed ? { resumed } : {}) });
  }

  forget(terminalId: string): void {
    this.#tracked.delete(terminalId);
  }

  /**
   * Rattache un onglet à une session connue par un hook.
   *
   * Prime sur la recherche : un `/clear` ou une reprise changent de transcript
   * sans que l'onglet change, et seul le hook le dit à coup sûr.
   */
  bind(terminalId: string, path: string, sessionId: string): void {
    const tracked = this.#tracked.get(terminalId);
    if (!tracked || tracked.path === path) return;
    tracked.path = path;
    tracked.reader = new TranscriptReader(path, sessionId);
    tracked.sent = undefined;
    void this.tick();
  }

  /** Vrai si un onglet suit ce transcript. */
  follows(path: string): boolean {
    const wanted = path.replace(/[\\/]+/g, "/").toLowerCase();
    return [...this.#tracked.values()].some(
      (tracked) => tracked.path?.replace(/[\\/]+/g, "/").toLowerCase() === wanted,
    );
  }

  /** États courants, pour un client qui se connecte en cours de route. */
  current(): { terminalId: string; session: LiveSession }[] {
    const out: { terminalId: string; session: LiveSession }[] = [];
    for (const [terminalId, tracked] of this.#tracked) {
      if (tracked.sent) out.push({ terminalId, session: JSON.parse(tracked.sent) as LiveSession });
    }
    return out;
  }

  /** Un passage : rattache ce qui peut l'être et relit ce qui l'est. Jamais deux à la fois. */
  tick(): Promise<void> {
    this.#running ??= this.#tickOnce().finally(() => {
      this.#running = undefined;
    });
    return this.#running;
  }

  async #tickOnce(): Promise<void> {
    const claimed = new Set(
      [...this.#tracked.values()].map((tracked) => tracked.path).filter((path): path is string => Boolean(path)),
    );

    for (const [terminalId, tracked] of this.#tracked) {
      if (!tracked.reader) {
        const match = await findLiveTranscript(tracked.cwd, tracked.since, claimed, this.home, tracked.resumed);
        if (!match) continue;
        tracked.path = match.path;
        tracked.reader = new TranscriptReader(match.path, match.sessionId);
        claimed.add(match.path);
      }

      let session: LiveSession;
      try {
        const { projection } = await tracked.reader.poll();
        // Une session reprise porte le mode de sa séance précédente : Claude
        // Code redémarre dans le sien, et le transcript ne le dira qu'au premier
        // tour. D'ici là, le mode n'est pas montré plutôt que montré faux.
        const fresh =
          !tracked.resumed ||
          (projection.lastActivityAt !== undefined && Date.parse(projection.lastActivityAt) >= tracked.since);
        session = {
          sessionId: projection.id,
          ...(projection.title ? { title: projection.title } : {}),
          ...(fresh && projection.permissionMode ? { permissionMode: projection.permissionMode } : {}),
          ...(fresh && projection.planMode !== undefined ? { planMode: projection.planMode } : {}),
          ...(projection.tokens ? { tokens: projection.tokens } : {}),
          ...(projection.cost ? { cost: projection.cost } : {}),
          ...(projection.tokens || projection.cost
            ? {
                price: sessionCost(
                  {
                    cost: projection.cost,
                    usage: projection.tokens?.byModel,
                    afterCost: projection.tokens?.afterCost,
                  },
                  this.#pricing(),
                ),
              }
            : {}),
          ...(projection.lastActivityAt ? { lastActivityAt: projection.lastActivityAt } : {}),
        };
      } catch {
        // Transcript illisible ou disparu : l'onglet garde son dernier état.
        continue;
      }

      const serialized = JSON.stringify(session);
      if (serialized === tracked.sent) continue;
      tracked.sent = serialized;
      for (const listener of this.#listeners) listener(terminalId, session);
    }
  }
}
