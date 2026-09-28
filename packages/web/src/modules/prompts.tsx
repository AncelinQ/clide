import { MessageSquareText } from "lucide-react";

import { PromptsPanel } from "@/components/PromptsPanel";
import type { WebModule } from "@/modules/types";

export const promptsModule: WebModule = {
  id: "prompts",
  title: "Prompts enregistrés",
  description: "Les prompts qu'on envoie souvent à Claude, d'un clic, par la palette (/) ou par un raccourci.",
  projectViews: [
    {
      id: "prompts",
      icon: MessageSquareText,
      label: "Prompts",
      about:
        "Les prompts qu'on envoie souvent à Claude : ceux du projet, versionnables dans .claude/clide-prompts.json, puis les siens. Un clic les envoie à l'onglet Claude du projet.",
      render: (root) => <PromptsPanel root={root} />,
    },
  ],
};
