import { useEffect, useMemo, useState } from "react";

import { ShortcutsEditor } from "@/components/ShortcutsEditor";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { t } from "@/i18n";
import { DEFAULT_TERMINAL_FONT, setState, useStore, type Language, type TerminalFont } from "@/state/store";
import { applyTerminalFont } from "@/state/terminals";

/** Polices à chasse fixe courantes sous Windows ; seules celles installées sont proposées. */
const CANDIDATES = [
  "Cascadia Mono",
  "Cascadia Code",
  "Consolas",
  "JetBrains Mono",
  "Fira Code",
  "Source Code Pro",
  "Hack",
  "Iosevka",
  "IBM Plex Mono",
  "Roboto Mono",
  "Ubuntu Mono",
  "CaskaydiaCove Nerd Font",
  "MesloLGS NF",
  "Lucida Console",
  "Courier New",
];

const DEFAULT = "__default__";
const MIN_SIZE = 9;
const MAX_SIZE = 24;

/**
 * Vrai si la police est installée.
 *
 * Une page ne peut pas lister les polices du système : on compare la largeur d'un
 * texte rendu dans la police demandée à celle de deux polices de secours. Si elle
 * diffère des deux, c'est que la police demandée a servi. Les secours sont
 * proportionnels : sous Windows, `monospace` est Consolas, qui passerait pour
 * absente.
 */
function installed(family: string): boolean {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return false;
  const sample = "mmmmmmmmmwwwwwiiiii0O@";
  return ["serif", "sans-serif"].every((fallback) => {
    context.font = `72px ${fallback}`;
    const base = context.measureText(sample).width;
    context.font = `72px "${family}", ${fallback}`;
    return context.measureText(sample).width !== base;
  });
}

function update(next: TerminalFont): void {
  setState({ terminalFont: next });
  applyTerminalFont(next);
}

/**
 * Préférences de l'application.
 *
 * Elles restent dans la configuration de l'application, jamais dans
 * `settings.json`, qui appartient à Claude Code.
 */
export function PreferencesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const font = useStore((state) => state.terminalFont);
  const language = useStore((state) => state.language);
  // Mesurées à l'ouverture seulement : une police installée entre-temps apparaît
  // à la suivante.
  const available = useMemo(() => (open ? CANDIDATES.filter(installed) : []), [open]);
  // Brouillon du champ : une saisie passe par des valeurs hors bornes (« 1 » avant
  // « 14 »), qu'un champ contrôlé par la seule valeur valide refuserait.
  const [size, setSize] = useState(String(font.size));
  useEffect(() => setSize(String(font.size)), [font.size]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Préférences")}</DialogTitle>
          <DialogDescription>
            {t("Propres à Clide, sans effet sur Claude Code.")}{" "}
            {/* Les deux se confondent : ceux de Claude Code vivent dans le panneau global. */}
            <button
              type="button"
              className="text-primary underline-offset-2 hover:underline"
              onClick={() => {
                onOpenChange(false);
                setState({ globalTab: "settings", showRight: true });
              }}
            >
              {t("Réglages de Claude Code (modèle, interface, permissions…)")}
            </button>
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>{t("Langue de l'interface")}</Label>
            <Select value={language} onValueChange={(value) => setState({ language: value as Language })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{t("Celle du système")}</SelectItem>
                <SelectItem value="fr">{t("Français")}</SelectItem>
                <SelectItem value="en">{t("Anglais")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label>{t("Police du terminal")}</Label>
            <Select
              value={font.family || DEFAULT}
              onValueChange={(value) => update({ ...font, family: value === DEFAULT ? "" : value })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT}>{t("Par défaut (Consolas)")}</SelectItem>
                {available.map((family) => (
                  <SelectItem key={family} value={family}>
                    <span style={{ fontFamily: `"${family}"` }}>{family}</span>
                  </SelectItem>
                ))}
                {font.family && !available.includes(font.family) && (
                  <SelectItem value={font.family}>{t("{family} (introuvable)", { family: font.family })}</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="terminal-font-size">{t("Taille (pt)")}</Label>
            <Input
              id="terminal-font-size"
              type="number"
              min={MIN_SIZE}
              max={MAX_SIZE}
              value={size}
              onChange={(event) => {
                setSize(event.target.value);
                const next = Number(event.target.value);
                if (Number.isInteger(next) && next >= MIN_SIZE && next <= MAX_SIZE) update({ ...font, size: next });
              }}
              onBlur={() => setSize(String(font.size))}
              className="w-24"
            />
          </div>

          <button
            type="button"
            className="justify-self-start text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => update(DEFAULT_TERMINAL_FONT)}
          >
            {t("Revenir aux valeurs par défaut")}
          </button>

          <ShortcutsEditor />
        </div>
      </DialogContent>
    </Dialog>
  );
}
