import { consumption } from "./consumption.js";
import { diagnostics } from "./diagnostics.js";
import { gitModule } from "./git.js";
import { prompts } from "./prompts.js";
import { scripts } from "./scripts.js";
import type { ServerModule } from "./module.js";

/** Modules du serveur, dans l'ordre où l'interface les présente. */
export const SERVER_MODULES: readonly ServerModule[] = [scripts, gitModule, prompts, diagnostics, consumption];
