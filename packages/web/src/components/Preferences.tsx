import { Bot, Coins, Keyboard, Palette, Settings2, SquareTerminal, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { LookPicker } from "@/components/LookPicker";
import { ShortcutsEditor } from "@/components/ShortcutsEditor";
import { SettingsPanel } from "@/components/panels/global";
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
import { cn } from "cn";
import { DEFAULT_TERMINAL_FONT, setState, useStore, type Language, type TabLayout, type TerminalFont } from "@/state/store";
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

/** Un groupe de réglages : un titre, une aide, puis les lignes. */
function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3">
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        {hint && <p className="text-[12px] text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/** Interrupteur à libellé, pour un réglage oui / non. */
function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" className="mt-1 size-4 accent-[var(--primary)]" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>
        <span className="block text-[13px]">{label}</span>
        {hint && <span className="block text-[12px] text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

function GeneralSection() {
  const language = useStore((state) => state.language);
  return (
    <Group title={t("Langue de l'interface")}>
      <Select value={language} onValueChange={(value) => setState({ language: value as Language })}>
        <SelectTrigger className="w-64">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">{t("Celle du système")}</SelectItem>
          <SelectItem value="fr">{t("Français")}</SelectItem>
          <SelectItem value="en">{t("Anglais")}</SelectItem>
        </SelectContent>
      </Select>
    </Group>
  );
}

function AppearanceSection() {
  const tabLayout = useStore((state) => state.tabLayout);
  return (
    <div className="grid gap-6">
      <LookPicker />
      <Group
        title={t("Onglets du panneau global")}
        hint={t("En colonne au bord de la fenêtre, comme les barres d'outils des IDE, ou en ligne au-dessus du panneau.")}
      >
        <Select value={tabLayout} onValueChange={(value) => setState({ tabLayout: value as TabLayout })}>
          <SelectTrigger className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="column">{t("En colonne")}</SelectItem>
            <SelectItem value="row">{t("En ligne")}</SelectItem>
          </SelectContent>
        </Select>
      </Group>
    </div>
  );
}

function TerminalSection({ open }: { open: boolean }) {
  const font = useStore((state) => state.terminalFont);
  // Mesurées à l'ouverture seulement : une police installée entre-temps apparaît
  // à la suivante.
  const available = useMemo(() => (open ? CANDIDATES.filter(installed) : []), [open]);
  // Brouillon du champ : une saisie passe par des valeurs hors bornes (« 1 » avant
  // « 14 »), qu'un champ contrôlé par la seule valeur valide refuserait.
  const [size, setSize] = useState(String(font.size));
  useEffect(() => setSize(String(font.size)), [font.size]);

  return (
    <Group title={t("Police du terminal")}>
      <Select value={font.family || DEFAULT} onValueChange={(value) => update({ ...font, family: value === DEFAULT ? "" : value })}>
        <SelectTrigger className="w-64">
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
    </Group>
  );
}

function CostsSection() {
  const showCosts = useStore((state) => state.showCosts);
  return (
    <Group
      title={t("Coûts")}
      hint={t("Ce que coûtent les sessions, déduit de ce que Claude Code en a relevé. L'onglet Coûts du panneau global reste là pour qui le cherche.")}
    >
      <Toggle
        label={t("Afficher les coûts")}
        hint={t("Dans l'historique, dans l'activité de la session et dans l'en-tête du terminal.")}
        checked={showCosts}
        onChange={(value) => setState({ showCosts: value })}
      />
    </Group>
  );
}

export type SettingsSection = "general" | "appearance" | "terminal" | "shortcuts" | "costs" | "claude";

const SECTIONS: { id: SettingsSection; icon: LucideIcon; label: string }[] = [
  { id: "general", icon: Settings2, label: "Général" },
  { id: "appearance", icon: Palette, label: "Apparence" },
  { id: "terminal", icon: SquareTerminal, label: "Terminal" },
  { id: "shortcuts", icon: Keyboard, label: "Raccourcis" },
  { id: "costs", icon: Coins, label: "Historique et coûts" },
  { id: "claude", icon: Bot, label: "Claude Code" },
];

/**
 * Réglages, dans une fenêtre : ceux de Clide, puis ceux de Claude Code.
 *
 * Les premiers restent dans la configuration de l'application, jamais dans
 * `settings.json` ; la section Claude Code, elle, édite `settings.json`, et le dit.
 */
export function SettingsDialog() {
  const open = useStore((state) => state.preferencesOpen);
  const section = useStore((state) => state.settingsSection) as SettingsSection;
  const close = () => setState({ preferencesOpen: false });

  const content = () => {
    switch (section) {
      case "appearance":
        return <AppearanceSection />;
      case "terminal":
        return <TerminalSection open={open} />;
      case "shortcuts":
        return <ShortcutsEditor />;
      case "costs":
        return <CostsSection />;
      case "claude":
        return (
          <Group
            title={t("Claude Code")}
            hint={t("Ces réglages sont ceux de Claude Code, dans son settings.json : ils valent pour toutes ses sessions, dans Clide ou non.")}
          >
            <SettingsPanel />
          </Group>
        );
      default:
        return <GeneralSection />;
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="flex h-[min(760px,calc(100vh-2rem))] max-w-none gap-0 p-0 sm:max-w-4xl">
        <DialogHeader className="sr-only">
          <DialogTitle>{t("Réglages")}</DialogTitle>
          <DialogDescription>{t("Réglages de Clide et de Claude Code.")}</DialogDescription>
        </DialogHeader>
        <nav className="flex w-52 shrink-0 flex-col gap-0.5 border-r p-2">
          <p className="px-2 pt-1 pb-2 text-sm font-medium">{t("Réglages")}</p>
          {SECTIONS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              data-section={entry.id}
              onClick={() => setState({ settingsSection: entry.id })}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors",
                entry.id === section ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              <entry.icon className="size-4" />
              {t(entry.label)}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto p-6">{content()}</div>
      </DialogContent>
    </Dialog>
  );
}
