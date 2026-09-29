/// <reference types="vite/client" />

/** Demande faite à la fenêtre de sélection du système. */
interface PickRequest {
  kind: "folder" | "file";
  title?: string;
  /** Dossier où la fenêtre s'ouvre. */
  start?: string;
  /** Extensions acceptées pour un fichier, sans point. */
  extensions?: string[];
}

/** Où en est la mise à jour de l'application de bureau. */
interface UpdateState {
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

/** Pont exposé par l'application de bureau. Absent dans un navigateur. */
interface ClideBridge {
  desktop: true;
  pathForFile(file: File): string | undefined;
  setAttention(waiting: number, badge?: string): void;
  focusWindow(): void;
  setZoom(factor: number): void;
  pick(request: PickRequest): Promise<string | undefined>;
  update: {
    get(): Promise<UpdateState>;
    check(): Promise<UpdateState>;
    /** Relance l'application sur la version téléchargée. */
    install(): void;
    /** Coupé, plus de vérification périodique ; « Rechercher » reste possible. */
    setAuto(enabled: boolean): void;
    /** Rend la fonction qui désabonne. */
    onChange(listener: (state: UpdateState) => void): () => void;
  };
}

interface Window {
  clide?: ClideBridge;
}
