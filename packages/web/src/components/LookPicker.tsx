import { ChevronRight } from "lucide-react";
import { useState } from "react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "cn";
import { t } from "@/i18n";
import { LOOK_PRESETS, gradientOf, presetOf, suggestedEnd, type Look, type LookPair } from "@/lib/looks";
import { setState, useStore, type Theme } from "@/state/store";
import { applyTheme, setTheme, useEffectiveMode, type Mode } from "@/state/theme";

function update(look: LookPair): void {
  setState({ look });
  applyTheme();
}

/** Pastille d'un habillage : sa toile, un îlot posé dessus, un trait d'accent. */
function Swatch({ look, selected }: { look: Look; selected: boolean }) {
  return (
    <span
      className={cn(
        "block h-10 w-16 rounded-md border p-1.5 shadow-xs",
        selected && "ring-2 ring-ring ring-offset-2 ring-offset-background",
      )}
      style={{ background: gradientOf(look) }}
    >
      <span className="block h-full w-full rounded-[3px] bg-card">
        <span className="mt-1 ml-1 block h-1 w-5 rounded-full" style={{ background: look.accent }} />
      </span>
    </span>
  );
}

function ColorInput({
  value,
  title,
  disabled,
  onChange,
}: {
  value: string;
  title: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <input
      type="color"
      value={value}
      title={title}
      aria-label={title}
      disabled={disabled}
      className="size-7 cursor-pointer disabled:cursor-default disabled:opacity-40"
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/** Une ligne de l'éditeur : les couleurs d'un mode. */
function LookRow({
  mode,
  look,
  shown,
  onChange,
}: {
  mode: Mode;
  look: Look;
  /** Ce mode est celui affiché : ses couleurs changent sous les yeux. */
  shown: boolean;
  onChange: (look: Look) => void;
}) {
  const graded = look.canvasEnd !== null;
  return (
    <div className="contents">
      <span
        className={cn("text-[12px]", shown ? "font-medium" : "text-muted-foreground")}
        title={shown ? t("Mode affiché") : undefined}
      >
        {mode === "light" ? t("Clair") : t("Sombre")}
      </span>
      <ColorInput value={look.accent} title={t("Accent")} onChange={(accent) => onChange({ ...look, accent })} />
      <ColorInput value={look.canvas} title={t("Toile")} onChange={(canvas) => onChange({ ...look, canvas })} />
      <span className="flex items-center gap-1.5">
        <input
          type="checkbox"
          className="accent-primary"
          title={t("Dégradé")}
          checked={graded}
          onChange={(event) => onChange({ ...look, canvasEnd: event.target.checked ? suggestedEnd(look) : null })}
        />
        <ColorInput
          value={look.canvasEnd ?? look.canvas}
          title={t("Seconde couleur du dégradé")}
          disabled={!graded}
          onChange={(canvasEnd) => onChange({ ...look, canvasEnd })}
        />
      </span>
      <input
        type="range"
        min={0}
        max={360}
        step={15}
        value={look.angle}
        disabled={!graded}
        title={t("Direction : {angle}°", { angle: look.angle })}
        className="w-full accent-primary disabled:opacity-40"
        onChange={(event) => onChange({ ...look, angle: Number(event.target.value) })}
      />
    </div>
  );
}

/**
 * Apparence et couleurs de l'interface : le mode, un preset ou des couleurs à soi.
 *
 * Les couleurs valent pour la toile — la barre de titre et le fond derrière les
 * îlots — et l'accent ; les îlots gardent la teinte de leur mode, et le terminal
 * ses couleurs. Chaque mode a les siennes : celles du mode affiché changent sous
 * les yeux, les autres attendent qu'on y passe.
 */
export function LookPicker() {
  const theme = useStore((state) => state.theme);
  const look = useStore((state) => state.look);
  const mode = useEffectiveMode();
  const preset = presetOf(look);
  // Ouvert d'emblée quand les couleurs ne sont plus celles d'un preset : c'est là qu'elles se voient.
  const [customOpen, setCustomOpen] = useState(!preset);

  return (
    <>
      <div className="grid gap-1.5">
        <Label>{t("Apparence")}</Label>
        <Select value={theme} onValueChange={(value) => setTheme(value as Theme)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">{t("Selon le système")}</SelectItem>
            <SelectItem value="light">{t("Claire")}</SelectItem>
            <SelectItem value="dark">{t("Sombre")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-1.5">
        <Label>{t("Couleurs de l'interface")}</Label>
        <p className="text-[11px] text-muted-foreground">
          {t("La barre de titre et le fond derrière les îlots ; le terminal garde ses couleurs.")}
        </p>
        <div className="flex flex-wrap gap-1">
          {LOOK_PRESETS.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              className="flex w-18 flex-col items-center gap-1 rounded-md py-1.5 text-center text-[11px] leading-tight outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
              onClick={() => update({ light: candidate.light, dark: candidate.dark })}
            >
              <Swatch look={candidate[mode]} selected={candidate.id === preset?.id} />
              <span>{t(candidate.name)}</span>
            </button>
          ))}
        </div>
        <Collapsible open={customOpen} onOpenChange={setCustomOpen}>
          <CollapsibleTrigger className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
            <ChevronRight className={cn("size-3 transition-transform", customOpen && "rotate-90")} />
            {preset ? t("Personnaliser") : t("Couleurs personnalisées")}
          </CollapsibleTrigger>
          <CollapsibleContent className="grid gap-1.5 pt-2">
            <div className="grid grid-cols-[3.5rem_auto_auto_auto_1fr] items-center gap-x-4 gap-y-2 text-[11px]">
              <span />
              <span className="text-muted-foreground">{t("Accent")}</span>
              <span className="text-muted-foreground">{t("Toile")}</span>
              <span className="text-muted-foreground">{t("Dégradé")}</span>
              <span className="text-muted-foreground">{t("Direction")}</span>
              <LookRow mode="light" look={look.light} shown={mode === "light"} onChange={(light) => update({ ...look, light })} />
              <LookRow mode="dark" look={look.dark} shown={mode === "dark"} onChange={(dark) => update({ ...look, dark })} />
            </div>
            <p className="text-[11px] text-muted-foreground">
              {t("Chaque mode a ses couleurs : celles du mode affiché s'appliquent aussitôt, les autres attendent qu'on y passe.")}
            </p>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </>
  );
}
