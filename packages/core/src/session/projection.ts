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

/** Tokens consommés par la session, sommés sur ses réponses distinctes. */
export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  /** Taille du contexte envoyé à la dernière réponse : entrée et cache compris. */
  context: number;
  model?: string;
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
  /**
   * La session est en mode plan. Deux chemins y mènent : le mode de permission
   * `plan` (Maj+Tab), et l'outil `EnterPlanMode` qu'appelle Claude lui-même ;
   * `ExitPlanMode` en sort en soumettant son plan.
   */
  planMode?: boolean;
  /** Fichier où Claude Code écrit le plan en cours, annoncé en mode plan. */
  planFilePath?: string;
  startedAt?: string;
  lastActivityAt?: string;
  cost?: CostState;
  tokens?: TokenUsage;
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
  /**
   * Consommation par réponse. Une réponse s'écrit en plusieurs events — un par
   * bloc de contenu — qui répètent le même `message.id` et le même `usage` :
   * les sommer compterait la même réponse deux ou trois fois.
   */
  readonly #usage = new Map<string, { input: number; output: number; cacheRead: number; cacheCreation: number }>();
  #lastUsage: { context: number; model?: string } | undefined;
  #state: Omit<SessionProjection, "files" | "unknownTypes" | "prLinks" | "tokens">;

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
      case "user": {
        s.messageCount += 1;
        // Le mode du tour est porté par le prompt lui-même. L'event
        // `permission-mode` est écrit à la fin du tour précédent : il dit `auto`
        // alors que le prompt qui suit part en mode plan.
        const mode = readString(event, "permissionMode");
        if (mode) {
          s.permissionMode = mode;
          s.planMode = mode === "plan";
        }
        break;
      }

      case "attachment": {
        const attachment = event["attachment"];
        if (typeof attachment === "object" && attachment !== null) {
          const record = attachment as Record<string, unknown>;
          if (record["type"] === "plan_mode") {
            s.planMode = true;
            if (typeof record["planFilePath"] === "string") s.planFilePath = record["planFilePath"];
          }
        }
        break;
      }

      case "assistant":
        s.messageCount += 1;
        this.#applyUsage(event);
        this.#applyPlanTools(event);
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
        if (mode) {
          s.permissionMode = mode;
          s.planMode = mode === "plan";
        }
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

  #applyPlanTools(event: TranscriptEvent): void {
    const message = event["message"];
    if (typeof message !== "object" || message === null) return;
    const content = (message as Record<string, unknown>)["content"];
    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (typeof block !== "object" || block === null) continue;
      const { type, name } = block as Record<string, unknown>;
      if (type !== "tool_use") continue;
      if (name === "EnterPlanMode") this.#state.planMode = true;
      if (name === "ExitPlanMode") this.#state.planMode = false;
    }
  }

  #applyUsage(event: TranscriptEvent): void {
    const message = event["message"];
    if (typeof message !== "object" || message === null) return;
    const record = message as Record<string, unknown>;
    const usage = record["usage"];
    const id = record["id"];
    if (typeof usage !== "object" || usage === null || typeof id !== "string") return;
    const u = usage as Record<string, unknown>;
    const count = (key: string): number => (typeof u[key] === "number" ? (u[key] as number) : 0);
    const entry = {
      input: count("input_tokens"),
      output: count("output_tokens"),
      cacheRead: count("cache_read_input_tokens"),
      cacheCreation: count("cache_creation_input_tokens"),
    };
    this.#usage.set(id, entry);
    const model = typeof record["model"] === "string" ? (record["model"] as string) : undefined;
    this.#lastUsage = {
      context: entry.input + entry.cacheRead + entry.cacheCreation,
      ...(model ? { model } : {}),
    };
  }

  #tokens(): TokenUsage | undefined {
    if (!this.#lastUsage) return undefined;
    const total = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
    for (const entry of this.#usage.values()) {
      total.input += entry.input;
      total.output += entry.output;
      total.cacheRead += entry.cacheRead;
      total.cacheCreation += entry.cacheCreation;
    }
    return { ...total, ...this.#lastUsage };
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
      ...(this.#lastUsage ? { tokens: this.#tokens() } : {}),
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
