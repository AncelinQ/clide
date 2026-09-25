import { BrainCircuit, Check } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { useStore } from "@/state/store";
import { openTerminal, sendToClaude } from "@/state/terminals";

interface ModelChoice {
  id: string;
  name: string;
  description?: string;
  main: boolean;
}

/** Catalogue lu une fois par page : il ne change qu'aux mises à jour de Claude Code. */
let catalog: Promise<ModelChoice[]> | undefined;

function loadModels(): Promise<ModelChoice[]> {
  catalog ??= api<{ models: ModelChoice[] }>("/api/models")
    .then((result) => result.models)
    .catch(() => {
      catalog = undefined;
      return [];
    });
  return catalog;
}

/**
 * Le modèle d'une réponse s'écrit avec sa date (`claude-haiku-4-5-20251001`) ou
 * sans ; un alias (`opus`) désigne une famille. Les deux se rapprochent par préfixe.
 */
function sameModel(choice: ModelChoice, used: string | undefined): boolean {
  return !!used && (used === choice.id || used.startsWith(`${choice.id}-`) || choice.id.startsWith(`${used}-`));
}

/**
 * Changer de modèle sans taper `/model`.
 *
 * Sur un onglet Claude, le choix est envoyé à la session : une commande tapée
 * pendant que Claude travaille part dans sa file, et s'applique au tour suivant.
 * Sans onglet Claude, il en ouvre un avec ce modèle.
 */
export function ModelPicker({ currentModel, disabled }: { currentModel?: string; disabled?: boolean }) {
  const [models, setModels] = useState<ModelChoice[]>([]);
  const activeRoot = useStore((state) => state.activeRoot);
  const hasClaude = useStore((state) =>
    Object.values(state.terminals).some(
      (entry) => entry.owner === state.activeRoot && entry.info.kind === "claude" && !entry.info.exited,
    ),
  );

  useEffect(() => {
    void loadModels().then(setModels);
  }, []);

  const current = models.find((model) => sameModel(model, currentModel));
  const main = models.filter((model) => model.main);
  const others = models.filter((model) => !model.main);

  const pick = (model: ModelChoice) => {
    if (hasClaude && sendToClaude(`/model ${model.id}`)) return;
    openTerminal("claude", { command: `claude --model ${model.id}` });
  };

  const item = (model: ModelChoice) => (
    <DropdownMenuItem key={model.id} onSelect={() => pick(model)} className="items-start">
      <Check className={current?.id === model.id ? "mt-0.5" : "invisible mt-0.5"} />
      <div className="min-w-0">
        <div>{model.name}</div>
        {model.description && <div className="text-[11px] text-muted-foreground">{model.description}</div>}
      </div>
    </DropdownMenuItem>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-[12px]"
          disabled={disabled || !activeRoot || models.length === 0}
          title={hasClaude ? t("Changer le modèle de la session") : t("Ouvrir Claude avec un modèle")}
        >
          <BrainCircuit />
          {current?.name ?? (currentModel ? currentModel.replace(/^claude-/, "") : t("Modèle"))}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
          {hasClaude ? t("Pour la session en cours (/model)") : t("Nouvel onglet Claude avec…")}
        </DropdownMenuLabel>
        {main.map(item)}
        {others.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>{t("Versions précédentes")}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-56">{others.map(item)}</DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
