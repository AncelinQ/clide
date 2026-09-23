import { EN } from "@/i18n/en";
import { getState, useStore, type Language } from "@/state/store";

/** Langue effective : celle choisie, ou celle du système quand on n'a rien choisi. */
export function resolvedLanguage(language: Language = getState().language): "fr" | "en" {
  if (language !== "auto") return language;
  return navigator.language.toLowerCase().startsWith("fr") ? "fr" : "en";
}

/**
 * Traduit une chaîne de l'interface.
 *
 * Le français est la source, écrit tel quel dans le code : il se lit à l'endroit où
 * il s'affiche, et il est la langue par défaut. L'anglais vient d'une table à côté ;
 * une chaîne qu'elle n'a pas s'affiche en français plutôt que de disparaître.
 *
 * `{nom}` est remplacé par la valeur de même nom : l'ordre des mots change d'une
 * langue à l'autre, une concaténation le figerait.
 */
export function t(french: string, values: Record<string, string | number> = {}): string {
  const text = resolvedLanguage() === "en" ? (EN[french] ?? french) : french;
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? String(values[key]) : whole));
}

/** Réabonne un composant à la langue : le changer redessine ce qui s'en sert. */
export function useLanguage(): "fr" | "en" {
  return resolvedLanguage(useStore((state) => state.language));
}
