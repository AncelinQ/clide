import { BrainCircuit, Camera, Copy, Gauge, MessageSquareText, MonitorPlay, Plus, Sparkles, SquareTerminal, X } from "lucide-react";
import { useState } from "react";

import { devServerItems, type DevServer } from "@/components/DevServers";
import { MenuButton, type MenuItem } from "@/components/Menu";
import { ScriptButtons } from "@/components/ScriptsShelf";
import { usePrompts } from "@/components/PromptsPanel";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { post } from "@/lib/api";
import { effortsFor, findModel, type ModelChoice } from "@/lib/models";
import type { TerminalInfo } from "@/lib/types";
import { captureInto, commands, effectiveShortcut } from "@/state/commands";
import { useModels } from "@/state/models";
import { getState } from "@/state/store";
import { runPrompt } from "@/state/prompts";
import { closeTerminal, openTerminal, sendToClaude } from "@/state/terminals";

/** Raccourci effectif d'une commande, surcharges de l'utilisateur comprises. */
function shortcutLabel(id: string): string | undefined {
  const command = commands().find((entry) => entry.id === id);
  return command ? effectiveShortcut(command, getState().shortcuts) : undefined;
}

/**
 * Les modèles principaux, puis les versions précédentes dans un sous-menu.
 * `current` coche le modèle en cours ; `null` quand il n'est pas connu.
 */
function modelItems(models: ModelChoice[], pick: (model: ModelChoice) => void, current?: ModelChoice | null): MenuItem[] {
  const entry = (model: ModelChoice): MenuItem => ({
    kind: "item",
    label: model.name,
    ...(model.description ? { hint: model.description } : {}),
    ...(current !== undefined ? { checked: model === current } : {}),
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
        hover
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
 * Barre flottante d'un onglet Claude, dans le coin du terminal comme les modes
 * d'un Markdown : le modèle et l'effort de la session, les prompts, l'aperçu du
 * serveur de développement. Chaque bouton montre la valeur en cours ; l'effort
 * n'apparaît que si le modèle en a un réglable.
 */
export function ClaudeToolbar({
  currentModel,
  currentEffort,
  servers,
}: {
  currentModel: string | undefined;
  currentEffort: string | undefined;
  servers: DevServer[];
}) {
  const models = useModels();
  const prompts = usePrompts();
  const serving = servers.length > 0;
  const model = findModel(models, currentModel);
  const modelLabel = model?.name ?? currentModel?.replace(/^claude-/, "") ?? t("Modèle");
  const efforts = effortsFor(model);
  const effort = efforts.find((choice) => choice.id === currentEffort);

  const modelMenu = (): MenuItem[] => [
    { kind: "label", label: t("Pour la session en cours (/model)") },
    ...modelItems(models, (choice) => void sendToClaude(`/model ${choice.id}`), model ?? null),
  ];
  const effortMenu = (): MenuItem[] => [
    { kind: "label", label: t("Pour la session et les suivantes du modèle (/effort)") },
    ...efforts.map(
      (choice): MenuItem => ({
        kind: "item",
        label: choice.name,
        ...(choice.recommended ? { hint: t("recommandé") } : {}),
        checked: choice.id === currentEffort,
        run: () => void sendToClaude(`/effort ${choice.id}`),
      }),
    ),
  ];
  const promptMenu = (): MenuItem[] =>
    prompts.map((prompt) => ({ kind: "item", label: prompt.label, hint: prompt.text, run: () => void runPrompt(prompt) }));

  const button = "h-6 gap-1 px-1.5 text-[11px] [&_svg]:size-3.5";
  return (
    // Discrète au repos : elle couvre le coin du terminal, où Claude écrit parfois.
    <div className="absolute top-2 right-4 z-10 flex gap-0.5 rounded-md border bg-card p-0.5 opacity-70 shadow-sm transition-opacity hover:opacity-100 focus-within:opacity-100">
      <MenuButton
        hover
        items={modelMenu}
        className="min-w-64"
        trigger={
          <Button variant="ghost" size="sm" className={button} title={t("Changer de modèle")}>
            <BrainCircuit />
            {modelLabel}
          </Button>
        }
      />
      {efforts.length > 0 && (
        <MenuButton
          hover
          items={effortMenu}
          trigger={
            <Button variant="ghost" size="sm" className={button} title={t("Changer d'effort")}>
              <Gauge />
              {effort?.name ?? currentEffort ?? t("Effort")}
            </Button>
          }
        />
      )}
      {prompts.length > 0 && (
        <MenuButton
          hover
          items={promptMenu}
          className="min-w-64"
          trigger={
            <Button variant="ghost" size="icon" className="size-6 [&_svg]:size-3.5" title={t("Prompts")}>
              <MessageSquareText />
            </Button>
          }
        />
      )}
      <MenuButton
        hover
        items={() => devServerItems(servers)}
        className="min-w-64"
        trigger={
          <Button
            variant="ghost"
            size="icon"
            className="relative size-6 [&_svg]:size-3.5"
            title={`${t("Serveurs de développement")} — ${serving ? t("un serveur tourne") : t("aucun serveur de développement ne tourne")}`}
          >
            <MonitorPlay />
            {serving && <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-emerald-500" />}
          </Button>
        }
      />
    </div>
  );
}

/**
 * Barre flottante d'un script, à la place de celle de Claude : l'arrêter et le
 * relancer sans revenir à la liste de l'onglet Scripts.
 */
export function ScriptToolbar({ info }: { info: TerminalInfo }) {
  return (
    <div
      className="absolute top-2 right-4 z-10 flex gap-0.5 rounded-md border bg-card p-0.5 opacity-70 shadow-sm transition-opacity empty:hidden hover:opacity-100 focus-within:opacity-100"
      data-script-toolbar
    >
      <ScriptButtons info={info} />
    </div>
  );
}

/** Menu contextuel d'un onglet de la barre ; « les autres » sont ceux de la barre, `barTabs`. */
export function tabItems(info: TerminalInfo, barTabs: string[]): MenuItem[] {
  return [
    { kind: "item", label: t("Fermer"), icon: X, run: () => closeTerminal(info.id) },
    {
      kind: "item",
      label: t("Fermer les autres onglets"),
      disabled: barTabs.length < 2,
      run: () => {
        for (const id of barTabs) if (id !== info.id) closeTerminal(id);
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
