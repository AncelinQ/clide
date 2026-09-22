import {
  isKnownEventType,
  readBackupRef,
  readCostState,
  readNumber,
  readString,
  readWorktreeSession,
  type CostState,
  type FileBackupRef,
  type PrLink,
  type TranscriptEvent,
} from "../transcript/events.js";

/** Fichier touché par la session, avec ses états successifs. */
export interface FileTrack {
  trackingPath: string;
  /** Aucune sauvegarde nommée : le fichier a été créé, son diff part du vide. */
  created: boolean;
  backups: FileBackupRef[];
}

export interface SessionProjection {
  id: string;
  /** Dossier déclaré au démarrage. */
  cwd?: string;
  /** Dossier courant après un `relocated`, typiquement un worktree. */
  relocatedCwd?: string;
  worktreePath?: string;
  originalCwd?: string;
  gitBranch?: string;
  version?: string;
  title?: string;
  lastPrompt?: string;
  agentName?: string;
  mode?: string;
  permissionMode?: string;
  startedAt?: string;
  lastActivityAt?: string;
  cost?: CostState;
  /** Session qui prend la suite de celle-ci. */
  continuedInSessionId?: string;
  prLinks: PrLink[];
  files: FileTrack[];
  messageCount: number;
  eventCount: number;
  /** Types jamais vus dans le corpus de référence, avec leur nombre d'occurrences. */
  unknownTypes: Record<string, number>;
}

/**
 * Réduit un flux d'events en état de session.
 *
 * L'ordre d'application est celui du fichier : un champ scalaire garde la
 * dernière valeur vue, ce qui donne l'état courant plutôt qu'initial. Un type
 * non reconnu est compté et ignoré, jamais propagé en exception : c'est ce qui
 * permet à un panneau de continuer à fonctionner quand le format gagne un event.
 */
export class SessionProjector {
  readonly #files = new Map<string, FileTrack>();
  readonly #unknown = new Map<string, number>();
  readonly #prLinks: PrLink[] = [];
  #state: Omit<SessionProjection, "files" | "unknownTypes" | "prLinks">;

  constructor(sessionId: string) {
    this.#state = { id: sessionId, messageCount: 0, eventCount: 0 };
  }

  apply(event: TranscriptEvent): void {
    const s = this.#state;
    s.eventCount += 1;

    // Métadonnées d'enveloppe, portées par n'importe quel event.
    const cwd = readString(event, "cwd");
    if (cwd) s.cwd ??= cwd;
    const branch = readString(event, "gitBranch");
    if (branch) s.gitBranch = branch;
    const version = readString(event, "version");
    if (version) s.version = version;
    const timestamp = readString(event, "timestamp");
    if (timestamp) {
      s.startedAt ??= timestamp;
      s.lastActivityAt = timestamp;
    }

    switch (event.type) {
      case "user":
      case "assistant":
        s.messageCount += 1;
        break;

      case "ai-title": {
        const title = readString(event, "aiTitle");
        if (title) s.title = title;
        break;
      }

      case "last-prompt": {
        const prompt = readString(event, "lastPrompt");
        if (prompt) s.lastPrompt = prompt;
        break;
      }

      case "agent-name": {
        const name = readString(event, "agentName");
        if (name) s.agentName = name;
        break;
      }

      case "mode": {
        const mode = readString(event, "mode");
        if (mode) s.mode = mode;
        break;
      }

      case "permission-mode": {
        const mode = readString(event, "permissionMode");
        if (mode) s.permissionMode = mode;
        break;
      }

      case "cost-state": {
        const cost = readCostState(event);
        if (cost) s.cost = cost;
        break;
      }

      case "relocated": {
        const relocated = readString(event, "relocatedCwd");
        if (relocated) s.relocatedCwd = relocated;
        break;
      }

      case "worktree-state": {
        const worktree = readWorktreeSession(event);
        if (worktree?.worktreePath) s.worktreePath = worktree.worktreePath;
        if (worktree?.originalCwd) s.originalCwd = worktree.originalCwd;
        break;
      }

      case "continued-in": {
        const next = readString(event, "continuedInSessionId");
        if (next) s.continuedInSessionId = next;
        break;
      }

      case "pr-link": {
        const url = readString(event, "prUrl");
        if (url && !this.#prLinks.some((link) => link.prUrl === url)) {
          this.#prLinks.push({
            prUrl: url,
            ...(readNumber(event, "prNumber") !== undefined
              ? { prNumber: readNumber(event, "prNumber") }
              : {}),
            ...(readString(event, "prRepository")
              ? { prRepository: readString(event, "prRepository") }
              : {}),
            ...(readString(event, "timestamp") ? { timestamp: readString(event, "timestamp") } : {}),
          });
        }
        break;
      }

      case "file-history-delta": {
        const trackingPath = readString(event, "trackingPath");
        const backup = readBackupRef(event);
        if (trackingPath && backup) {
          const track = this.#files.get(trackingPath) ?? {
            trackingPath,
            created: true,
            backups: [],
          };
          // Une création n'a pas de nom de sauvegarde : dédupliquer sur le seul
          // nom confondrait toutes les créations d'un même fichier.
          const key = `${backup.backupFileName ?? ""}|${backup.version}|${backup.backupTime ?? ""}`;
          const known = track.backups.some(
            (b) => `${b.backupFileName ?? ""}|${b.version}|${b.backupTime ?? ""}` === key,
          );
          if (!known) {
            track.backups.push(backup);
            track.backups.sort((a, b) => a.version - b.version);
          }
          track.created = track.backups.every((b) => b.backupFileName === null);
          this.#files.set(trackingPath, track);
        }
        break;
      }

      default:
        if (!isKnownEventType(event.type)) {
          this.#unknown.set(event.type, (this.#unknown.get(event.type) ?? 0) + 1);
        }
    }
  }

  /**
   * Dossier à utiliser pour rattacher la session à un projet. Un worktree ou un
   * `relocated` déplace la session après son démarrage : l'indexer sur son `cwd`
   * initial la rangerait au mauvais endroit.
   */
  get effectiveCwd(): string | undefined {
    return this.#state.relocatedCwd ?? this.#state.worktreePath ?? this.#state.cwd;
  }

  snapshot(): SessionProjection {
    return {
      ...this.#state,
      prLinks: [...this.#prLinks],
      files: [...this.#files.values()],
      unknownTypes: Object.fromEntries(this.#unknown),
    };
  }
}

export function projectEvents(sessionId: string, events: Iterable<TranscriptEvent>): SessionProjection {
  const projector = new SessionProjector(sessionId);
  for (const event of events) projector.apply(event);
  return projector.snapshot();
}
