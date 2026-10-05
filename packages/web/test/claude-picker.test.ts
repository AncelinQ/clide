import { describe, expect, it } from "vitest";

import { effortSlider, highlightedModel, inputDraft, isModelPicker, isSwitchConfirm, type ScreenRow } from "../src/lib/claude-picker";

/** La confirmation qui suit `s` dans une conversation entamée. */
const SWITCH_CONFIRM = [
  "─────────────────────────────────────────────────────────────────",
  "  Switch model?",
  "  Your next response will be slower and use more tokens",
  "  This conversation is cached for the current model. Switching",
  "  to Opus 5.5 means the full history gets re-read on your next",
  "  message.",
  "  ❯ 1. Yes, switch to Opus 5.5 ",
  "    2. No, go back",
];

/** Le sélecteur de `/model` de Claude Code v2.1.289, relevé dans une vraie session. */
const MODEL_PICKER = [
  "─────────────────────────────────────────────────────────────────",
  "  Select model",
  "  Switch between Claude models. Your pick becomes the default ",
  "  for new sessions. For other/previous model names, specify ",
  "  with --model.",
  "    1.  Default (recommended)  Opus 5.5 · Best for everyday,     ",
  "                               complex tasks",
  "  ❯ 2.  Opus 5.5 ✔             For complex work and everyday     ",
  "                               tasks",
  "     … +10 models",
  "  ◉ xHigh effort ←/→ to adjust",
  "  Enter to set as default · s to use this session only · Esc to  ",
  "  cancel",
];

/** Le curseur de `/effort`, sur medium. */
const EFFORT_SLIDER = [
  "❯ /effort                                                        ",
  "─────────────────────────────────────────────────────────────────",
  "  Effort",
  "            Faster                             Smarter",
  "            ──────────▲───────────────────────────────",
  "            low     medium     high     xhigh      max",
  "                          Ultracode  off",
  "  ←/→ to adjust · Enter to confirm · s for this session only ·",
  "  Esc to cancel",
];

describe("le sélecteur de modèle", () => {
  it("se reconnaît, et donne le nom de la ligne surlignée sans sa coche", () => {
    expect(isModelPicker(MODEL_PICKER)).toBe(true);
    expect(highlightedModel(MODEL_PICKER)).toBe("Opus 5.5");
    expect(highlightedModel(["  ❯ 4.  Sonnet 5.5             Most efficient for simpler tasks"])).toBe("Sonnet 5.5");
    expect(highlightedModel(["  ❯ 12. Sonnet 4.6"])).toBe("Sonnet 4.6");
  });

  it("ne se confond pas avec l'invite de Claude ni avec le curseur d'effort", () => {
    expect(isModelPicker(EFFORT_SLIDER)).toBe(false);
    expect(highlightedModel(["❯ /model", "❯ Try \"how does <filepath> work?\""])).toBeUndefined();
  });

  it("reconnaît la confirmation d'un changement dans une conversation entamée", () => {
    expect(isSwitchConfirm(SWITCH_CONFIRM)).toBe(true);
    expect(isModelPicker(SWITCH_CONFIRM)).toBe(false);
    expect(isSwitchConfirm(MODEL_PICKER)).toBe(false);
  });
});

describe("le curseur d'effort", () => {
  it("lit ses niveaux et celui sous le repère", () => {
    expect(effortSlider(EFFORT_SLIDER)).toEqual({ levels: ["low", "medium", "high", "xhigh", "max"], current: 1 });
    const high = EFFORT_SLIDER.map((line) => (line.includes("▲") ? "            ────────────────────▲─────────────────────" : line));
    expect(effortSlider(high)?.current).toBe(2);
  });

  it("n'est pas lu ailleurs que dans le curseur", () => {
    expect(effortSlider(MODEL_PICKER)).toBeUndefined();
  });
});

describe("inputDraft", () => {
  const row = (text: string, dimFrom = Infinity): ScreenRow => ({ text, dim: [...text].map((_, at) => at >= dimFrom) });
  const rule = row("─────────────────────────");

  it("lit ce qu'on a tapé sous le filet", () => {
    expect(inputDraft([row("❯ /model"), row(""), rule, row("❯ corrige le test"), rule])).toBe("corrige le test");
  });

  it("ne compte pas une suggestion estompée, ni une ligne vide", () => {
    expect(inputDraft([rule, row('❯ Try "how does <filepath> work?"', 2), rule])).toBe("");
    expect(inputDraft([rule, row("❯ "), rule])).toBe("");
  });

  it("garde le texte tapé devant une suggestion estompée", () => {
    expect(inputDraft([rule, row("❯ /mo del", 5), rule])).toBe("/mo");
  });

  it("ne trouve pas de ligne de saisie sous un sélecteur ou une demande de permission", () => {
    expect(inputDraft(MODEL_PICKER.map((text) => row(text)))).toBeUndefined();
    expect(inputDraft([row("Do you want to proceed?"), row("❯ 1. Yes"), row("  2. No")])).toBeUndefined();
  });
});
