import { NotebookPen } from "lucide-react";

import { MemoPanel } from "@/components/MemoPanel";
import type { WebModule } from "@/modules/types";

export const memoModule: WebModule = {
  id: "memo",
  title: "Mémo",
  description: "Les liens, les notes et les fichiers épinglés de chaque projet, gardés hors du dépôt.",
  projectViews: [
    {
      id: "memo",
      icon: NotebookPen,
      label: "Mémo",
      about:
        "Les liens du projet (docs, tickets, maquettes), tes notes à son sujet et les fichiers que tu ouvres souvent. Tout reste dans les données de Clide, rien dans le dépôt.",
      doc: "projet#memo",
      render: (root) => <MemoPanel root={root} />,
    },
  ],
};
