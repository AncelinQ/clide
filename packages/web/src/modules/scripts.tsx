import { Package } from "lucide-react";

import { ScriptsPanel } from "@/components/panels/scripts";
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
      about: "Scripts du package.json, espaces de travail compris, et commandes des autres outils (make, cargo, go, python, scripts). Chacun tourne dans son onglet ; cochés, ils se lancent ensemble.",
      render: (root) => <ScriptsPanel root={root} />,
    },
  ],
};
