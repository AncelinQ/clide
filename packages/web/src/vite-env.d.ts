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

/** Pont exposé par l'application de bureau. Absent dans un navigateur. */
interface ClideBridge {
  desktop: true;
  pathForFile(file: File): string | undefined;
  setAttention(waiting: number, badge?: string): void;
  focusWindow(): void;
  setZoom(factor: number): void;
  pick(request: PickRequest): Promise<string | undefined>;
}

interface Window {
  clide?: ClideBridge;
}
