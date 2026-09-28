import { consumption } from "@/modules/consumption";
import { diagnosticsModule } from "@/modules/diagnostics";
import { git } from "@/modules/git";
import { promptsModule } from "@/modules/prompts";
import { scripts } from "@/modules/scripts";
import type { BottomView, GlobalView, ProjectView, WebModule } from "@/modules/types";

/** Modules de l'interface, dans l'ordre où leurs vues s'ajoutent aux barres. */
export const WEB_MODULES: readonly WebModule[] = [scripts, git, diagnosticsModule, promptsModule, consumption];

function enabled(disabled: readonly string[]): WebModule[] {
  return WEB_MODULES.filter((module) => !disabled.includes(module.id));
}

/** Vues du panneau global apportées par les modules actifs. */
export function moduleGlobalViews(disabled: readonly string[]): GlobalView[] {
  return enabled(disabled).flatMap((module) => module.globalViews ?? []);
}

/** Modes du bloc sous le terminal apportés par les modules actifs. */
export function moduleBottomViews(disabled: readonly string[]): BottomView[] {
  return enabled(disabled).flatMap((module) => module.bottomViews ?? []);
}

/** Vues de la colonne du projet apportées par les modules actifs. */
export function moduleProjectViews(disabled: readonly string[]): ProjectView[] {
  return enabled(disabled).flatMap((module) => module.projectViews ?? []);
}
