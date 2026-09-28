import { consumption } from "./consumption.js";
import { scripts } from "./scripts.js";
import type { ServerModule } from "./module.js";

/** Modules du serveur, dans l'ordre où l'interface les présente. */
export const SERVER_MODULES: readonly ServerModule[] = [scripts, consumption];
