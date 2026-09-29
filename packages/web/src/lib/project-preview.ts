export type PreviewSource = "servers" | "browser";

export interface PreviewState {
  previewOpen: boolean;
  previewSource: PreviewSource;
}

interface WithPreviews<P extends { root: string } & PreviewState> extends PreviewState {
  activeRoot: string | null;
  projects: P[];
}

/** L'aperçu d'un projet, fermé pour un projet inconnu. */
export function previewOf(project: PreviewState | undefined): PreviewState {
  return { previewOpen: project?.previewOpen ?? false, previewSource: project?.previewSource ?? "servers" };
}

/**
 * L'aperçu suit le projet : changer de projet reprend le sien, et l'ouvrir, le
 * fermer ou changer sa source l'écrit dans le projet actif. Un patch qui change
 * de projet et d'aperçu à la fois vaut pour le nouveau projet.
 */
export function followPreview<P extends { root: string } & PreviewState>(
  previous: WithPreviews<P>,
  current: WithPreviews<P>,
  patched: readonly string[],
): Partial<WithPreviews<P>> {
  const explicit = patched.includes("previewOpen") || patched.includes("previewSource");
  if (current.activeRoot !== previous.activeRoot && !explicit) {
    return previewOf(current.projects.find((project) => project.root === current.activeRoot));
  }
  const moved = current.activeRoot !== previous.activeRoot;
  if (!moved && current.previewOpen === previous.previewOpen && current.previewSource === previous.previewSource) return {};
  return {
    projects: current.projects.map((project) =>
      project.root === current.activeRoot
        ? { ...project, previewOpen: current.previewOpen, previewSource: current.previewSource }
        : project,
    ),
  };
}
