import { useEffect, useState } from "react";

import { Keys } from "@/components/CommandPalette";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { commands, effectiveShortcut, isUsableShortcut, shortcutOf } from "@/state/commands";
import { setState, useStore } from "@/state/store";

/**
 * Raccourcis modifiables, rangés dans la configuration de l'application — jamais
 * dans `settings.json`, qui appartient à Claude Code.
 *
 * Pendant l'enregistrement, l'écoute globale se tait : la combinaison tapée est
 * pour l'éditeur, pas pour l'action qu'elle déclenche d'ordinaire. Une
 * combinaison déjà prise est retirée de l'autre commande, et on le dit.
 */
export function ShortcutsEditor() {
  const overrides = useStore((state) => state.shortcuts);
  const [recording, setRecording] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const all = commands();

  useEffect(() => {
    if (!recording) return;
    document.body.dataset["recordingShortcut"] = "true";
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setRecording(undefined);
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        setState((current) => ({ shortcuts: { ...current.shortcuts, [recording]: null } }));
        setRecording(undefined);
        return;
      }
      const shortcut = shortcutOf(event);
      if (!shortcut) return;
      if (!isUsableShortcut(shortcut)) {
        setNotice(t("{shortcut} se tape : un raccourci demande Ctrl ou Alt.", { shortcut }));
        return;
      }
      const taken = all.find((command) => command.id !== recording && effectiveShortcut(command, overrides) === shortcut);
      setState((current) => ({
        shortcuts: {
          ...current.shortcuts,
          [recording]: shortcut,
          ...(taken ? { [taken.id]: null } : {}),
        },
      }));
      setNotice(
        taken
          ? t("{shortcut} était à « {label} », qui n'a plus de raccourci.", { shortcut, label: taken.label })
          : undefined,
      );
      setRecording(undefined);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => {
      delete document.body.dataset["recordingShortcut"];
      window.removeEventListener("keydown", onKey, { capture: true });
    };
  }, [recording, overrides, all]);

  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">{t("Raccourcis")}</span>
        {Object.keys(overrides).length > 0 && (
          <button
            type="button"
            className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => {
              setState({ shortcuts: {} });
              setNotice(undefined);
            }}
          >
            {t("tout remettre par défaut")}
          </button>
        )}
      </div>
      {notice && <p className="text-[11px] text-amber-600 dark:text-amber-400">{notice}</p>}
      <ul className="m-0 grid max-h-64 list-none gap-0.5 overflow-auto p-0">
        {all.map((command) => {
          const shortcut = effectiveShortcut(command, overrides);
          const changed = command.id in overrides;
          return (
            <li key={command.id} className="flex items-center gap-2 py-0.5 text-[12px]">
              <span className="min-w-0 flex-1 truncate" title={command.group}>
                {command.label}
              </span>
              {recording === command.id ? (
                <span className="text-[11px] text-primary">{t("tape la combinaison… (Échap : annuler, Suppr : aucun)")}</span>
              ) : shortcut ? (
                <Keys shortcut={shortcut} />
              ) : (
                <span className="text-[11px] text-muted-foreground">—</span>
              )}
              <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => setRecording(command.id)}>
                {t("modifier")}
              </Button>
              {changed && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px] text-muted-foreground"
                  title={t("revenir au raccourci par défaut")}
                  onClick={() =>
                    setState((current) => {
                      const shortcuts = { ...current.shortcuts };
                      delete shortcuts[command.id];
                      return { shortcuts };
                    })
                  }
                >
                  {t("défaut")}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
