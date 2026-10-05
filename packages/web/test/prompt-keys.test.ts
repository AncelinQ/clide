import { describe, expect, it } from "vitest";

import { PROMPT_KEYS, isShadowing, numberNew, promptCommand, shadowedBy, type KeyedPrompt } from "../src/lib/prompt-keys";

const prompt = (id: string, scope: KeyedPrompt["scope"] = "user"): KeyedPrompt => ({ id, label: id.toUpperCase(), scope });

describe("numberNew", () => {
  it("donne aux prompts jamais numérotés le premier numéro libre, dans l'ordre de la liste", () => {
    expect(numberNew([prompt("a"), prompt("b")], {})).toEqual({
      [promptCommand("a")]: "Ctrl+Shift+1",
      [promptCommand("b")]: "Ctrl+Shift+2",
    });
  });

  it("ne touche à rien quand chaque prompt a déjà son entrée", () => {
    expect(numberNew([prompt("a"), prompt("b")], { [promptCommand("a")]: "Ctrl+Shift+4", [promptCommand("b")]: null })).toBeUndefined();
  });

  it("garde un numéro fixe : en supprimer un ne décale pas les autres, le trou attend le prochain", () => {
    const overrides = { [promptCommand("a")]: "Ctrl+Shift+1", [promptCommand("c")]: "Ctrl+Shift+3" };
    expect(numberNew([prompt("a"), prompt("c"), prompt("d")], overrides)).toEqual({ [promptCommand("d")]: "Ctrl+Shift+2" });
  });

  it("évite une touche donnée à une autre commande, pas celle d'un prompt d'un autre projet", () => {
    const overrides = { "tab.shell": "Ctrl+Shift+1", [promptCommand("ailleurs")]: "Ctrl+Shift+2" };
    expect(numberNew([prompt("a")], overrides)).toEqual({ [promptCommand("a")]: "Ctrl+Shift+2" });
  });

  it("au-delà de neuf, retient qu'un prompt n'a pas de touche", () => {
    const overrides = Object.fromEntries(PROMPT_KEYS.map((key, index) => [promptCommand(`p${index}`), key]));
    const prompts = PROMPT_KEYS.map((_, index) => prompt(`p${index}`));
    expect(numberNew([...prompts, prompt("dixième")], overrides)).toEqual({ [promptCommand("dixième")]: null });
  });
});

describe("shadowedBy", () => {
  it("dit quel prompt du projet prend la touche d'un prompt perso", () => {
    const prompts = [prompt("p", "project"), prompt("u"), prompt("v")];
    const overrides = { [promptCommand("p")]: "Ctrl+Shift+1", [promptCommand("u")]: "Ctrl+Shift+1", [promptCommand("v")]: "Ctrl+Shift+2" };
    expect(shadowedBy(prompts, overrides)).toEqual({ u: prompts[0] });
  });

  it("ne masque rien entre deux prompts perso", () => {
    const overrides = { [promptCommand("u")]: "Ctrl+Shift+1", [promptCommand("v")]: "Ctrl+Shift+1" };
    expect(shadowedBy([prompt("u"), prompt("v")], overrides)).toEqual({});
  });
});

describe("isShadowing", () => {
  const prompts = [prompt("p", "project"), prompt("q", "project"), prompt("u"), prompt("v")];
  const ids = (...names: string[]) => names.map(promptCommand);

  it("tient pour la règle un prompt du projet devant des prompts perso", () => {
    expect(isShadowing(ids("p", "u"), prompts)).toBe(true);
    expect(isShadowing(ids("p", "u", "v"), prompts)).toBe(true);
  });

  it("garde comme conflits deux prompts de même portée, ou un prompt et une autre commande", () => {
    expect(isShadowing(ids("u", "v"), prompts)).toBe(false);
    expect(isShadowing(ids("p", "q"), prompts)).toBe(false);
    expect(isShadowing([promptCommand("p"), "tab.shell"], prompts)).toBe(false);
  });
});
