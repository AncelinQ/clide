import { BrainCircuit, Camera, Copy, Ellipsis, MonitorPlay, Plus, Sparkles, SquareTerminal, X } from "lucide-react";
import { useState } from "react";

import { MenuButton, type MenuItem } from "@/components/Menu";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { post } from "@/lib/api";
import type { TerminalInfo } from "@/lib/types";
import { captureInto, commands, effectiveShortcut } from "@/state/commands";
import { sameModel, useModels, type ModelChoice } from "@/state/models";
import { getState, setState, useStore } from "@/state/store";
import { closeTerminal, openTerminal, sendToClaude } from "@/state/terminals";
import { cn } from "cn";

/** Raccourci effectif d'une commande, surcharges de l'utilisateur comprises. */
function shortcutLabel(id: string): string | undefined {
  const command = commands().find((entry) => entry.id === id);
  return command ? effectiveShortcut(command, getState().shortcuts) : undefined;
}

/** Les modèles principaux, puis les versions précédentes dans un sous-menu. */
function modelItems(models: ModelChoice[], pick: (model: ModelChoice) => void, current?: string): MenuItem[] {
  const entry = (model: ModelChoice): MenuItem => ({
    kind: "item",
    label: model.name,
    ...(model.description ? { hint: model.description } : {}),
    ...(current !== undefined ? { checked: sameModel(model, current) } : {}),
    run: () => pick(model),
  });
  const others = models.filter((model) => !model.main);
  return [
    ...models.filter((model) => model.main).map(entry),
    ...(others.length > 0
      ? ([{ kind: "separator" }, { kind: "submenu", label: t("Versions précédentes"), items: others.map(entry) }] as MenuItem[])
      : []),
  ];
}

/**
 * Capture d'écran vers le prompt de l'onglet actif. Pendant la capture, la
 * relancer l'annule : l'outil de Windows peut rester ouvert, ou être fermé sans
 * que rien ne revienne.
 */
function useCapture(terminalId: string | undefined) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const start = async () => {
    if (!terminalId) return;
    if (busy) {
      await post("/api/capture/cancel", {}).catch(() => undefined);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await captureInto(terminalId);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, start };
}

/**
 * Ce qu'on ouvre dans le projet : Claude, Claude avec un modèle choisi, un
 * shell, et la capture d'écran vers le prompt de l'onglet actif.
 */
export function NewTabMenu({ disabled, terminalId }: { disabled: boolean; terminalId: string | undefined }) {
  const models = useModels();
  const capture = useCapture(terminalId);

  const items = (): MenuItem[] => [
    {
      kind: "item",
      label: t("Claude"),
      icon: Sparkles,
      ...(shortcutLabel("tab.claude") ? { shortcut: shortcutLabel("tab.claude") } : {}),
      run: () => openTerminal("claude", { command: "claude" }),
    },
    {
      kind: "submenu",
      label: t("Claude avec le modèle"),
      icon: BrainCircuit,
      items: modelItems(models, (model) => openTerminal("claude", { command: `claude --model ${model.id}` })),
    },
    {
      kind: "item",
      label: t("Shell"),
      icon: SquareTerminal,
      ...(shortcutLabel("tab.shell") ? { shortcut: shortcutLabel("tab.shell") } : {}),
      run: () => openTerminal("shell"),
    },
    { kind: "separator" },
    {
      kind: "item",
      label: t("Capture d'écran vers le prompt"),
      icon: Camera,
      ...(capture.error ? { hint: capture.error } : {}),
      ...(shortcutLabel("tab.capture") ? { shortcut: shortcutLabel("tab.capture") } : {}),
      disabled: !terminalId,
      run: () => void capture.start(),
    },
  ];

  return (
    <>
      {capture.busy && (
        <Button
          variant="ghost"
          size="icon"
          className="size-7 bg-accent"
          title={t("Annuler la capture")}
          onClick={() => void capture.start()}
        >
          <Camera className="animate-pulse" />
        </Button>
      )}
      <MenuButton
        items={items}
        trigger={
          <Button variant="ghost" size="icon" className="size-7" disabled={disabled} title={t("Nouvel onglet")}>
            <Plus />
          </Button>
        }
      />
    </>
  );
}

/**
 * Ce qui porte sur l'onglet actif et la zone du terminal : le modèle de la
 * session Claude, l'aperçu du serveur de développement, les autres onglets. Le
 * déclencheur montre le modèle en cours, qu'on lisait sur le bouton du même nom.
 */
export function ToolsMenu({
  disabled,
  active,
  currentModel,
  serving,
  ownTabs,
}: {
  disabled: boolean;
  active: TerminalInfo | undefined;
  currentModel: string | undefined;
  serving: boolean;
  ownTabs: string[];
}) {
  const models = useModels();
  const previewOpen = useStore((state) => state.previewOpen);
  const claude = active?.kind === "claude" && !active.exited;
  const model = models.find((choice) => sameModel(choice, currentModel));
  const modelLabel = model?.name ?? currentModel?.replace(/^claude-/, "");

  const items = (): MenuItem[] => [
    ...(claude
      ? ([
          {
            kind: "submenu",
            label: t("Changer de modèle"),
            icon: BrainCircuit,
            items: [
              { kind: "label", label: t("Pour la session en cours (/model)") },
              ...modelItems(models, (choice) => void sendToClaude(`/model ${choice.id}`), currentModel ?? ""),
            ],
          },
          { kind: "separator" },
        ] as MenuItem[])
      : []),
    {
      kind: "item",
      label: t("Aperçu du serveur de développement"),
      icon: MonitorPlay,
      checked: previewOpen,
      hint: serving ? t("un serveur tourne") : t("aucun serveur de développement ne tourne"),
      run: () => setState({ previewOpen: !previewOpen }),
    },
    { kind: "separator" },
    ...(active
      ? ([
          {
            kind: "item",
            label: t("Copier le dossier de l'onglet"),
            icon: Copy,
            run: () => void navigator.clipboard.writeText(active.cwd),
          },
          {
            kind: "item",
            label: t("Fermer les autres onglets"),
            icon: X,
            disabled: ownTabs.length < 2,
            run: () => {
              for (const id of ownTabs) if (id !== active.id) closeTerminal(id);
            },
          },
        ] as MenuItem[])
      : []),
  ];

  return (
    <MenuButton
      items={items}
      className="min-w-64"
      trigger={
        <Button
          variant="ghost"
          size="sm"
          className={cn("relative h-7 gap-1 px-2 text-[12px]", !claude && "w-7 px-0")}
          disabled={disabled}
          title={t("Onglet et aperçu")}
        >
          {claude && modelLabel ? (
            <>
              <BrainCircuit />
              {modelLabel}
            </>
          ) : (
            <Ellipsis />
          )}
          {/* Un serveur tourne : un point, pas une couleur, qui ferait croire le bouton enfoncé. */}
          {serving && <span className="absolute top-1 right-1 size-1.5 rounded-full bg-emerald-500" />}
        </Button>
      }
    />
  );
}

/** Menu contextuel d'un onglet de la barre. */
export function tabItems(info: TerminalInfo, ownTabs: string[]): MenuItem[] {
  return [
    { kind: "item", label: t("Fermer"), icon: X, run: () => closeTerminal(info.id) },
    {
      kind: "item",
      label: t("Fermer les autres onglets"),
      disabled: ownTabs.length < 2,
      run: () => {
        for (const id of ownTabs) if (id !== info.id) closeTerminal(id);
      },
    },
    { kind: "separator" },
    {
      kind: "item",
      label: t("Copier le dossier de l'onglet"),
      icon: Copy,
      run: () => void navigator.clipboard.writeText(info.cwd),
    },
  ];
}
