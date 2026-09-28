import type { TestTarget } from "@/lib/test-commands";
import type { TestSuite } from "@/lib/types";

/** Une ligne qu'on lance depuis la marge de l'éditeur. */
export interface RunnableLine {
  /** Ligne comptée à partir de 1. */
  line: number;
  /** Nom du script : il désigne aussi son onglet (`dossier|nom`). */
  name: string;
  /** Dossier et commande, prêts pour `runScript`. */
  directory: string;
  run: string;
  kind: "script" | "make" | "shell" | "test";
  /** Pour un test : sa suite et ce qu'il faut lancer, pour `runTests`. */
  test?: { suite: TestSuite; target: TestTarget };
}

export interface RunnableContext {
  /** Gestionnaire du dossier du `package.json` : `npm`, `pnpm`, `yarn`, `bun`. */
  manager: string;
  /** Suites connues du projet : les tests d'un fichier ouvert s'y trouvent. */
  suites?: readonly TestSuite[];
}

const SHELL_FENCES = new Set(["sh", "bash", "shell", "zsh", "console", "powershell", "ps1", "pwsh", "ps"]);
/** Longueur au-delà de laquelle le nom d'une commande de Markdown est tronqué dans l'onglet. */
const NAME_LIMIT = 40;

function dirOf(path: string): string {
  return path.replace(/[\\/][^\\/]*$/, "");
}

function baseOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function sameFile(a: string, b: string): boolean {
  const clean = (value: string) => value.replace(/\//g, "\\").toLowerCase();
  return clean(a) === clean(b);
}

/** Les clés de `scripts` d'un `package.json`, à leur ligne, lues sans le parser en entier. */
function packageScripts(path: string, lines: string[], manager: string): RunnableLine[] {
  const found: RunnableLine[] = [];
  const start = lines.findIndex((line) => /^\s*"scripts"\s*:\s*\{/.test(line));
  if (start === -1) return found;
  const directory = dirOf(path);
  let depth = 0;
  for (let index = start; index < lines.length; index++) {
    const line = lines[index] as string;
    const key = /^\s*"((?:\\.|[^"\\])+)"\s*:/.exec(line);
    if (depth === 1 && key) {
      const name = (key[1] as string).replace(/\\(.)/g, "$1");
      found.push({ line: index + 1, name, directory, run: manager === "npm" ? `npm run ${name}` : `${manager} run ${name}`, kind: "script" });
    }
    // Les accolades dans les commandes sont entre guillemets : on les ignore.
    for (const char of line.replace(/"(?:\\.|[^"\\])*"/g, "")) {
      if (char === "{") depth++;
      else if (char === "}") depth--;
    }
    if (depth <= 0 && index > start) break;
  }
  return found;
}

/** Les cibles d'un Makefile : `nom:` en début de ligne, hors cibles spéciales et règles à motif. */
function makeTargets(path: string, lines: string[]): RunnableLine[] {
  const directory = dirOf(path);
  const found: RunnableLine[] = [];
  lines.forEach((line, index) => {
    const match = /^([A-Za-z0-9_][A-Za-z0-9_.\-/]*)\s*:(?![:=])/.exec(line);
    if (!match) return;
    const name = match[1] as string;
    found.push({ line: index + 1, name, directory, run: `make ${name}`, kind: "make" });
  });
  return found;
}

/** Retire l'invite d'une ligne de console : `$ `, `> `, `PS> `, `PS C:\dossier> `. */
function withoutPrompt(line: string): { command: string; prompted: boolean } {
  const match = /^\s*(?:\$|>|PS(?: [^>]*)?>)\s+(.*)$/.exec(line);
  return match ? { command: (match[1] as string).trim(), prompted: true } : { command: line.trim(), prompted: false };
}

/**
 * Les commandes des blocs de code shell d'un Markdown, une par ligne. Dans un
 * bloc `console`, seules les lignes à invite sont des commandes : le reste est
 * leur sortie.
 */
function markdownCommands(path: string, lines: string[]): RunnableLine[] {
  const directory = dirOf(path);
  const found: RunnableLine[] = [];
  let fence: { marker: string; lang: string } | undefined;
  lines.forEach((line, index) => {
    const opening = /^\s*(`{3,}|~{3,})\s*([\w-]*)/.exec(line);
    if (!fence) {
      if (opening) fence = { marker: opening[1] as string, lang: (opening[2] as string).toLowerCase() };
      return;
    }
    if (line.trim().startsWith(fence.marker)) {
      fence = undefined;
      return;
    }
    if (!SHELL_FENCES.has(fence.lang)) return;
    const { command, prompted } = withoutPrompt(line);
    if (!command || command.startsWith("#")) return;
    if (fence.lang === "console" && !prompted) return;
    const name = command.length > NAME_LIMIT ? `${command.slice(0, NAME_LIMIT - 1)}…` : command;
    found.push({ line: index + 1, name, directory, run: command, kind: "shell" });
  });
  return found;
}

/** Un script PowerShell ou shell ouvert : sa première ligne lance le fichier entier. */
function scriptFile(path: string): RunnableLine[] {
  const name = baseOf(path);
  const quoted = `'${path.replace(/'/g, "''")}'`;
  const run = /\.ps1$/i.test(path) ? `& ${quoted}` : `bash ${quoted.replace(/\\/g, "/")}`;
  return [{ line: 1, name, directory: dirOf(path), run, kind: "shell" }];
}

/** Les tests du fichier ouvert, à la ligne où le serveur les a lus. */
function testLines(path: string, suites: readonly TestSuite[]): RunnableLine[] {
  const found: RunnableLine[] = [];
  for (const suite of suites) {
    const base = suite.directory.replace(/[\\/]+$/, "");
    for (const file of suite.files) {
      if (!sameFile(`${base}\\${file.path}`, path)) continue;
      for (const test of file.tests) {
        found.push({
          line: test.line,
          name: [...test.parents, test.name].join(" › "),
          directory: suite.directory,
          run: "",
          kind: "test",
          test: { suite, target: { path: file.path, name: test.name, parents: test.parents } },
        });
      }
    }
  }
  return found;
}

/**
 * Les lignes d'un fichier qui se lancent depuis la marge : les scripts d'un
 * `package.json`, les cibles d'un Makefile, les commandes des blocs shell d'un
 * Markdown, un script `.ps1` ou `.sh` entier, et les tests d'un fichier de test.
 * Une ligne n'y figure qu'une fois.
 */
export function runnableLines(path: string, text: string, context: RunnableContext): RunnableLine[] {
  const lines = text.split(/\r?\n/);
  const name = baseOf(path).toLowerCase();
  const found =
    name === "package.json"
      ? packageScripts(path, lines, context.manager)
      : name === "makefile" || name === "gnumakefile" || name.endsWith(".mk")
        ? makeTargets(path, lines)
        : name.endsWith(".md") || name.endsWith(".markdown")
          ? markdownCommands(path, lines)
          : name.endsWith(".ps1") || name.endsWith(".sh")
            ? scriptFile(path)
            : testLines(path, context.suites ?? []);
  const seen = new Set<number>();
  return found.filter((item) => !seen.has(item.line) && seen.add(item.line));
}
