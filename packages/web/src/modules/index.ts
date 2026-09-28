import { consumption } from "@/modules/consumption";
import { scripts } from "@/modules/scripts";
import type { GlobalView, ProjectView, WebModule } from "@/modules/types";

/** Modules de l'interface, dans l'ordre où leurs vues s'ajoutent aux barres. */
export const WEB_MODULES: readonly WebModule[] = [scripts, consumption];

function enabled(disabled: readonly string[]): WebModule[] {
  return WEB_MODULES.filter((module) => !disabled.includes(module.id));
}

/** Vues du panneau global apportées par les modules actifs. */
export function moduleGlobalViews(disabled: readonly string[]): GlobalView[] {
  return enabled(disabled).flatMap((module) => module.globalViews ?? []);
}

/** Vues de la colonne du projet apportées par les modules actifs. */
export function moduleProjectViews(disabled: readonly string[]): ProjectView[] {
  return enabled(disabled).flatMap((module) => module.projectViews ?? []);
}
