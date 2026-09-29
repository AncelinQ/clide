import { app } from "electron";
import { autoUpdater } from "electron-updater";

/** Où en est la mise à jour de l'application, tel que la page l'affiche. */
export interface UpdateState {
  status: "unsupported" | "idle" | "checking" | "none" | "downloading" | "ready" | "error";
  /** Version en cours d'exécution. */
  current: string;
  /** Version trouvée, en téléchargement ou prête à installer. */
  version?: string;
  /** Avancement du téléchargement, en pour cent. */
  progress?: number;
  error?: string;
  /** Dernière vérification terminée, en millisecondes depuis l'époque. */
  checkedAt?: number;
}

const FIRST_CHECK = 10_000;
const EVERY = 6 * 3600_000;

/**
 * Mises à jour depuis les releases GitHub (la cible `publish` d'electron-builder.yml).
 *
 * La version trouvée se télécharge seule et s'installe à la fermeture de
 * l'application ; `install` l'applique tout de suite en relançant. Une version de
 * développement (`electron .`) n'a pas d'installeur à remplacer : elle ne vérifie
 * rien.
 *
 * Le réglage « automatiques » est mémorisé par la page, qui le transmet dès son
 * chargement, bien avant la première vérification.
 */
export class Updater {
  private state: Omit<UpdateState, "current">;
  private timer: ReturnType<typeof setInterval> | undefined;
  private auto = true;

  constructor(private readonly emit: (state: UpdateState) => void) {
    this.state = app.isPackaged ? { status: "idle" } : { status: "unsupported", error: "version de développement" };
  }

  get(): UpdateState {
    return { ...this.state, current: app.getVersion() };
  }

  start(): void {
    if (this.state.status === "unsupported") return;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on("checking-for-update", () => this.set({ status: "checking" }));
    autoUpdater.on("update-not-available", () => this.set({ status: "none", checkedAt: Date.now() }));
    autoUpdater.on("update-available", (info) => this.set({ status: "downloading", version: info.version, progress: 0 }));
    autoUpdater.on("download-progress", (progress) =>
      this.set({ status: "downloading", version: this.state.version, progress: Math.round(progress.percent) }),
    );
    autoUpdater.on("update-downloaded", (info) =>
      this.set({ status: "ready", version: info.version, checkedAt: Date.now() }),
    );
    autoUpdater.on("error", (error) =>
      this.set({ status: "error", error: error.message, version: this.state.version, checkedAt: Date.now() }),
    );
    setTimeout(() => this.scheduled(), FIRST_CHECK);
    this.timer = setInterval(() => this.scheduled(), EVERY);
  }

  /** Coupé, plus aucune vérification planifiée ; `check` reste possible à la demande. */
  setAuto(enabled: boolean): void {
    this.auto = enabled;
  }

  stop(): void {
    clearInterval(this.timer);
  }

  /** Une version déjà téléchargée ou en cours de téléchargement n'est pas recherchée de nouveau. */
  check(): UpdateState {
    const busy = ["unsupported", "checking", "downloading", "ready"];
    if (!busy.includes(this.state.status)) {
      // Les échecs arrivent aussi par l'événement `error`, qui les affiche.
      autoUpdater.checkForUpdates().catch(() => undefined);
    }
    return this.get();
  }

  /** Ferme l'application, installe la version téléchargée sans assistant, puis la rouvre. */
  install(): void {
    if (this.state.status === "ready") autoUpdater.quitAndInstall(true, true);
  }

  private scheduled(): void {
    if (this.auto) this.check();
  }

  private set(state: Omit<UpdateState, "current">): void {
    this.state = state;
    this.emit(this.get());
  }
}
