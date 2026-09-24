/// <reference types="vite/client" />

/** Pont exposé par l'application de bureau. Absent dans un navigateur. */
interface ClideBridge {
  desktop: true;
  pathForFile(file: File): string | undefined;
  setAttention(waiting: number, badge?: string): void;
  focusWindow(): void;
}

interface Window {
  clide?: ClideBridge;
}
