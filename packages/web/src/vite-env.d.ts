/// <reference types="vite/client" />

/** Pont exposé par l'application de bureau. Absent dans un navigateur. */
interface ClaudeIdeBridge {
  desktop: true;
  pathForFile(file: File): string | undefined;
  setAttention(waiting: number): void;
}

interface Window {
  claudeIde?: ClaudeIdeBridge;
}
