import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  ScriptStore,
  detectTests,
  mergeResults,
  parseJsonReport,
  parseJunit,
  type Framework,
  type TestResult,
  type TestSuite,
} from "@clide/core";

import { requireParam } from "../api/routes.js";
import type { ServerModule } from "./module.js";

/** Nom de fichier stable d'un dossier de suite, pour ranger son rapport et ses résultats. */
function slug(directory: string): string {
  return createHash("sha1").update(directory.toLowerCase()).digest("hex").slice(0, 16);
}

function reportPath(dataDir: string, directory: string, framework: Framework): string {
  return join(dataDir, "tests", `${slug(directory)}-${framework}.${framework === "pytest" ? "xml" : "json"}`);
}

function resultsPath(dataDir: string, directory: string): string {
  return join(dataDir, "tests", `${slug(directory)}.results.json`);
}

async function readResults(dataDir: string, directory: string): Promise<TestResult[]> {
  try {
    return JSON.parse(await readFile(resultsPath(dataDir, directory), "utf8")) as TestResult[];
  } catch {
    return [];
  }
}

/** Les dossiers où chercher des tests : le projet et ses espaces de travail. */
async function directoriesOf(root: string): Promise<string[]> {
  const scripts = await new ScriptStore().read(root).catch(() => undefined);
  const directories = [root, ...(scripts?.sources.map((source) => source.directory) ?? [])];
  return [...new Map(directories.map((directory) => [directory.toLowerCase(), directory])).values()];
}

/**
 * Relit le rapport d'une suite, plus récent que `since`. Il peut s'écrire juste
 * après la fin de la commande : trois essais, à 300 ms d'écart, avant de conclure
 * qu'il manque.
 */
async function readReport(path: string, since: number, framework: Framework, directory: string): Promise<TestResult[] | undefined> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const info = await stat(path);
      if (info.mtimeMs + 1000 >= since) {
        const text = await readFile(path, "utf8");
        if (framework === "pytest") return parseJunit(text);
        // Vitest et Jest écrivent le chemin réel : un dossier connu par son nom court
        // Windows (`ADM-A~1`) ou par un lien ne s'y retrouverait pas.
        let real = directory;
        try {
          real = realpathSync.native(directory);
        } catch {
          // Dossier disparu : le rapport garde alors ses chemins absolus.
        }
        return parseJsonReport(text, real);
      }
    } catch {
      // Absent ou encore incomplet : on attend un peu.
    }
    await new Promise((done) => setTimeout(done, 300));
  }
  return undefined;
}

/**
 * Tests du projet : les suites Vitest, Jest et pytest de chaque package, le
 * chemin du rapport machine que la commande de lancement doit écrire, et les
 * derniers résultats connus, gardés d'une page à l'autre.
 */
export const tests: ServerModule = {
  id: "tests",
  routes: {
    "/api/tests": async (params, { dataDir }) => {
      const root = requireParam(params, "root");
      const suites: (TestSuite & { reportPath: string; results: TestResult[] })[] = [];
      for (const directory of await directoriesOf(root)) {
        for (const suite of await detectTests(directory)) {
          suites.push({
            ...suite,
            reportPath: reportPath(dataDir, directory, suite.framework),
            results: await readResults(dataDir, directory),
          });
        }
      }
      return { suites };
    },

    /** Relit le rapport écrit par le dernier lancement, et le fond dans les résultats connus. */
    "/api/tests/results": async (params, { dataDir, workspace }) => {
      const directory = await workspace.resolve(requireParam(params, "directory"));
      const framework = requireParam(params, "framework") as Framework;
      if (framework !== "vitest" && framework !== "jest" && framework !== "pytest") throw new Error("outil de test inconnu");
      const since = Number(params.get("since") ?? 0);
      const fresh = await readReport(reportPath(dataDir, directory, framework), since, framework, directory);
      const known = await readResults(dataDir, directory);
      if (!fresh) return { results: known, stale: true };
      // Un seul test lancé : `only` est sa clé, les autres « sautés » par le filtre gardent leur état.
      const results = mergeResults(known, fresh, params.get("only") ?? undefined);
      await mkdir(join(dataDir, "tests"), { recursive: true });
      await writeFile(resultsPath(dataDir, directory), JSON.stringify(results), "utf8");
      return { results };
    },
  },
};
