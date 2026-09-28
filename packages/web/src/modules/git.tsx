import { GitBranch, GitCommitHorizontal, GitGraph } from "lucide-react";

import { CommitPanel } from "@/components/git/CommitPanel";
import { CommitsPanel } from "@/components/git/CommitsPanel";
import { GitView } from "@/components/git/GitView";
import type { WebModule } from "@/modules/types";

export const git: WebModule = {
  id: "git",
  title: "Git",
  description: "La branche et ses gestes, les fichiers à commiter, le journal avec son graphe, les diffs.",
  projectViews: [
    {
      id: "git",
      icon: GitBranch,
      label: "Git",
      doc: "git",
      about: "La branche courante, son écart avec l'amont, et les autres branches du dépôt.",
      render: (root) => <GitView root={root} />,
    },
    {
      id: "commit",
      icon: GitCommitHorizontal,
      label: "Commit",
      doc: "git#commiter",
      about:
        "Les fichiers modifiés du projet, à cocher, en liste ou rangés par dossier : seuls les fichiers cochés partent, dans leur état sur disque. Double-clic : leur diff.",
      render: (root) => <CommitPanel root={root} />,
    },
  ],
  bottomViews: [
    {
      id: "commits",
      icon: GitGraph,
      title: "Commits",
      doc: "git",
      about: "Le journal de toutes les branches avec son graphe ; un commit montre son message et ses fichiers.",
      render: (root) => <CommitsPanel root={root} />,
    },
  ],
};
