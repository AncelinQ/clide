import { FlaskConical, Package } from "lucide-react";

import { ScriptsPanel } from "@/components/panels/scripts";
import { TestsPanel } from "@/components/panels/tests";
import type { WebModule } from "@/modules/types";

export const scripts: WebModule = {
  id: "scripts",
  title: "Scripts",
  description: "Les scripts du package.json du projet et de ses dossiers liés, et ses tests, lancés dans un onglet.",
  projectViews: [
    {
      id: "scripts",
      icon: Package,
      label: "Scripts",
      doc: "projet#lancer-un-script",
      about: "Scripts du package.json, espaces de travail compris, et commandes des autres outils (make, cargo, go, python, scripts). Chacun tourne dans son onglet ; cochés, ils se lancent ensemble.",
      render: (root) => <ScriptsPanel root={root} />,
    },
    {
      id: "tests",
      icon: FlaskConical,
      label: "Tests",
      doc: "projet#lancer-les-tests",
      about: "Tests Vitest, Jest et pytest du projet et de ses espaces de travail, par fichier. Toute la suite, un fichier ou un test se lance dans l'onglet de sa suite ; le rapport écrit à la fin donne l'état de chaque test.",
      render: (root) => <TestsPanel root={root} />,
    },
  ],
};
