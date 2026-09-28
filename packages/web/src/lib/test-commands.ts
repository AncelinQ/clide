export type Framework = "vitest" | "jest" | "pytest";

/** Ce qu'on lance : toute la suite, un fichier, ou un test d'un fichier. */
export interface TestTarget {
  /** Chemin relatif au dossier de la suite, séparé par `/`. */
  path?: string;
  name?: string;
  parents?: string[];
}

/** Une chaîne entre apostrophes pour PowerShell : l'apostrophe se double. */
function quote(text: string): string {
  return `'${text.replace(/'/g, "''")}'`;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Commande PowerShell qui lance une cible et écrit le rapport machine à
 * `reportPath`, que le serveur relit ensuite. Vitest et Jest filtrent un test par
 * `-t`, une expression comparée au nom complet (blocs et nom joints par une
 * espace), ancrée pour ne pas attraper un voisin au nom plus long ; pytest le
 * désigne par son identifiant `fichier::Classe::test`.
 */
export function buildTestCommand(framework: Framework, reportPath: string, target: TestTarget = {}): string {
  if (framework === "pytest") {
    const node = target.path ? [target.path, ...(target.name ? [...(target.parents ?? []), target.name] : [])].join("::") : undefined;
    return ["python -m pytest", `--junitxml=${quote(reportPath)}`, ...(node ? [quote(node)] : [])].join(" ");
  }
  const filter = target.name ? `^${escapeRegex([...(target.parents ?? []), target.name].join(" "))}$` : undefined;
  const base =
    framework === "vitest"
      ? `npx --no-install vitest run --reporter=default --reporter=json --outputFile=${quote(reportPath)}`
      : `npx --no-install jest --json --outputFile=${quote(reportPath)}`;
  return [base, ...(target.path ? [quote(target.path)] : []), ...(filter ? ["-t", quote(filter)] : [])].join(" ");
}

/** Nom du script d'une suite : son onglet se retrouve d'un lancement à l'autre. */
export function testScriptName(framework: Framework): string {
  return framework === "pytest" ? "pytest" : "tests";
}
