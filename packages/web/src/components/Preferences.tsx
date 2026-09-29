import { Blocks, Bot, Coins, Keyboard, Palette, Settings2, SquareTerminal, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { FolderInput } from "@/components/FolderInput";
import { LookPicker } from "@/components/LookPicker";
import { ShortcutsEditor } from "@/components/ShortcutsEditor";
import { SettingsPanel } from "@/components/panels/global";
import { WEB_MODULES } from "@/modules";
import type { WebModule } from "@/modules/types";
import { Button } from "@/components/ui/button";
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
import { setImportedTheme } from "@/state/theme";
import { setInterfaceFont } from "@/state/interface";
import { UI_SCALES } from "@/lib/saved-state";
import { fromVscodeTheme, parseJsonc } from "@/lib/vscode-theme";

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

/** Polices d'interface courantes sous Windows ; seules celles installées sont proposées. */
const UI_CANDIDATES = ["Segoe UI Variable Text", "Aptos", "Inter", "Roboto", "Open Sans", "Source Sans 3", "Noto Sans", "Calibri", "Arial", "Verdana", "Tahoma"];

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
  const projectsFolder = useStore((state) => state.projectsFolder);
  return (
    <div className="grid gap-6">
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
      <Group
        title={t("Dossier des projets")}
        hint={t("Là où s'ouvre « Parcourir… » quand le champ est vide : ouvrir un projet, lier un dossier.")}
      >
        <FolderInput
          value={projectsFolder}
          onChange={(value) => setState({ projectsFolder: value })}
          title={t("Dossier des projets")}
          placeholder={t("C:\\Projets")}
        />
      </Group>
    </div>
  );
}

/**
 * Import d'un thème VS Code : le `.json` d'une extension de thème, choisi sur le
 * disque. Il remplace l'habillage, le mode clair ou sombre, le terminal et
 * l'éditeur, jusqu'à ce qu'on le retire.
 */
function VscodeThemeGroup() {
  const imported = useStore((state) => state.vscodeTheme);
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const load = async (file: File) => {
    setError(undefined);
    try {
      setImportedTheme(fromVscodeTheme(parseJsonc(await file.text()), file.name.replace(/\.jsonc?$/i, "")));
    } catch (caught) {
      setError(caught instanceof SyntaxError ? t("JSON illisible : {message}", { message: caught.message }) : t((caught as Error).message));
    }
  };
  return (
    <Group
      title={t("Thème VS Code")}
      hint={t(
        "Le .json d'un thème VS Code (dans le dossier themes/ de son extension) : ses couleurs vont à l'interface, au terminal et à l'éditeur. Il impose son mode clair ou sombre tant qu'il est chargé.",
      )}
    >
      <input
        ref={input}
        type="file"
        accept=".json,.jsonc,application/json"
        className="hidden"
        data-vscode-theme-file
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void load(file);
          event.target.value = "";
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => input.current?.click()}>
          {t("Charger un thème…")}
        </Button>
        {imported && (
          <>
            <span className="text-[12px]" data-vscode-theme-name>
              {t("{name} ({mode})", { name: imported.name, mode: imported.mode === "dark" ? t("sombre") : t("clair") })}
            </span>
            <Button variant="ghost" size="sm" onClick={() => setImportedTheme(null)}>
              {t("Retirer")}
            </Button>
          </>
        )}
      </div>
      {error && <p className="text-[12px] text-destructive">{error}</p>}
    </Group>
  );
}

/**
 * Police et taille de l'interface — colonnes, menus, fenêtres —, à part de celles
 * du terminal et de l'éditeur, qui gardent les leurs.
 */
function InterfaceFontGroup({ open }: { open: boolean }) {
  const font = useStore((state) => state.uiFont);
  const available = useMemo(() => (open ? UI_CANDIDATES.filter(installed) : []), [open]);
  return (
    <Group
      title={t("Police de l'interface")}
      hint={t("Colonnes, menus et fenêtres. Le terminal et l'éditeur gardent leur police et leur taille, réglées à part.")}
    >
      <Select value={font.family || DEFAULT} onValueChange={(value) => setInterfaceFont({ ...font, family: value === DEFAULT ? "" : value })}>
        <SelectTrigger className="w-64" data-ui-font>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT}>{t("Par défaut (Segoe UI)")}</SelectItem>
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
        <Label>{t("Taille")}</Label>
        <Select value={String(font.scale)} onValueChange={(value) => setInterfaceFont({ ...font, scale: Number(value) })}>
          <SelectTrigger className="w-32" data-ui-scale>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {UI_SCALES.map((scale) => (
              <SelectItem key={scale} value={String(scale)}>
                {scale === 100 ? t("{scale} % (par défaut)", { scale }) : `${scale} %`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </Group>
  );
}

function AppearanceSection({ open }: { open: boolean }) {
  const tabLayout = useStore((state) => state.tabLayout);
  const imported = useStore((state) => state.vscodeTheme);
  return (
    <div className="grid gap-6">
      <InterfaceFontGroup open={open} />
      <VscodeThemeGroup />
      {imported && <p className="-mt-3 text-[11px] text-muted-foreground">{t("Le thème VS Code chargé passe devant l'habillage choisi ci-dessous.")}</p>}
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
    <Group title={t("Police du terminal")} hint={t("Le terminal seulement : l'interface a sa propre police, dans Apparence.")}>
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

function ModulesSection() {
  const disabled = useStore((state) => state.disabledModules);
  const toggle = (module: WebModule, on: boolean) =>
    setState((current) => {
      const disabledModules = on
        ? current.disabledModules.filter((id) => id !== module.id)
        : [...current.disabledModules, module.id];
      // L'onglet ouvert disparaît avec son module : le panneau revient sur l'historique.
      const closing = !on && (module.globalViews ?? []).some((view) => view.id === current.globalTab);
      return { disabledModules, ...(closing ? { globalTab: "history" } : {}) };
    });
  return (
    <Group
      title={t("Modules")}
      hint={t("Chaque module ajoute ses vues aux barres. Coupé, il n'apparaît plus nulle part ; rien de ce qu'il a écrit n'est effacé.")}
    >
      {WEB_MODULES.map((module) => (
        <Toggle
          key={module.id}
          label={t(module.title)}
          hint={t(module.description)}
          checked={!disabled.includes(module.id)}
          onChange={(on) => toggle(module, on)}
        />
      ))}
    </Group>
  );
}

export type SettingsSection = "general" | "appearance" | "terminal" | "shortcuts" | "costs" | "modules" | "claude";

const SECTIONS: { id: SettingsSection; icon: LucideIcon; label: string }[] = [
  { id: "general", icon: Settings2, label: "Général" },
  { id: "appearance", icon: Palette, label: "Apparence" },
  { id: "terminal", icon: SquareTerminal, label: "Terminal" },
  { id: "shortcuts", icon: Keyboard, label: "Raccourcis" },
  { id: "costs", icon: Coins, label: "Historique et coûts" },
  { id: "modules", icon: Blocks, label: "Modules" },
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
        return <AppearanceSection open={open} />;
      case "terminal":
        return <TerminalSection open={open} />;
      case "shortcuts":
        return <ShortcutsEditor />;
      case "costs":
        return <CostsSection />;
      case "modules":
        return <ModulesSection />;
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
