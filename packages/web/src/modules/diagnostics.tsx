import { CircleAlert, ListTodo } from "lucide-react";

import { DiagnosticsPanel } from "@/components/panels/diagnostics";
import type { WebModule } from "@/modules/types";

export const diagnosticsModule: WebModule = {
  id: "diagnostics",
  title: "Erreurs et TODO",
  description: "Le tsc et l'ESLint du projet en arrière-plan, et ses TODO, dans le bloc sous le terminal.",
  bottomViews: [
    {
      id: "errors",
      icon: CircleAlert,
      title: "Erreurs",
      about:
        "Les erreurs du tsc et de l'ESLint installés dans le projet, recalculées à l'ouverture, à chaque enregistrement et à chaque fin de tour de Claude. Un clic ouvre le fichier à la ligne.",
      render: (root) => <DiagnosticsPanel root={root} kind="errors" />,
    },
    {
      id: "todos",
      icon: ListTodo,
      title: "TODO",
      about: "Les TODO, FIXME, HACK et XXX des commentaires et du Markdown du projet.",
      render: (root) => <DiagnosticsPanel root={root} kind="todos" />,
    },
  ],
};
