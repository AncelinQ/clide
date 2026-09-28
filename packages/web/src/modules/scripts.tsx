import { Package } from "lucide-react";

import { ScriptsPanel } from "@/components/panels/project";
import type { WebModule } from "@/modules/types";

export const scripts: WebModule = {
  id: "scripts",
  title: "Scripts",
  description: "Les scripts du package.json du projet et de ses dossiers liés, lancés dans un onglet.",
  projectViews: [
    {
      id: "scripts",
      icon: Package,
      label: "Scripts",
      doc: "projet#lancer-un-script",
      about: "Scripts du package.json, espaces de travail compris. Le gestionnaire vient du lockfile.",
      render: (root) => <ScriptsPanel root={root} />,
    },
  ],
};
