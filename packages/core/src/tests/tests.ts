import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { listProjectFiles } from "../files/find.js";

export type Framework = "vitest" | "jest" | "pytest";

/** Un test lu dans son fichier : son nom et ceux des blocs qui l'englobent. */
export interface TestCase {
  name: string;
  /** Ligne comptée à partir de 1. */
  line: number;
  parents: string[];
}

export interface TestFile {
  /** Chemin relatif au dossier de la suite, séparé par `/`. */
  path: string;
  tests: TestCase[];
}

/** Les tests d'un package, avec l'outil qui les lance. */
export interface TestSuite {
  framework: Framework;
  /** Dossier absolu d'où lancer l'outil. */
  directory: string;
  files: TestFile[];
}

export interface TestResult {
  /** Chemin relatif au dossier de la suite, séparé par `/`. */
  path: string;
  name: string;
  parents: string[];
  status: "passed" | "failed" | "skipped";
  durationMs?: number;
  /** Message de l'échec, tronqué. */
  failure?: string;
}

const FAILURE_LIMIT = 4096;

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

const JS_TEST = /(^|\/)[^/]+\.(test|spec)\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const PY_TEST = /(^|\/)(test_[^/]+|[^/]+_test)\.py$/;

/**
 * Noms des tests d'un fichier, lus par expressions et non par un analyseur : un
 * nom construit à l'exécution (gabarit, variable) n'est pas vu. Pour JS,
 * `describe` / `it` / `test`, avec `.only`, `.skip`, `.each(…)`, imbriqués par
 * indentation ; pour Python, `def test_…` et les classes `Test…`.
 */
export function parseTestNames(text: string, framework: Framework): TestCase[] {
  const found: TestCase[] = [];
  const stack: { indent: number; name: string }[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    const indent = line.length - line.trimStart().length;
    while (stack.length > 0 && (stack[stack.length - 1] as { indent: number }).indent >= indent && line.trim() !== "") stack.pop();
    if (framework === "pytest") {
      const klass = /^\s*class\s+(Test\w*)\b/.exec(line);
      if (klass) {
        stack.push({ indent, name: klass[1] as string });
        return;
      }
      const fn = /^\s*(?:async\s+)?def\s+(test\w*)\s*\(/.exec(line);
      if (fn) found.push({ name: fn[1] as string, line: index + 1, parents: stack.map((item) => item.name) });
      return;
    }
    const match = /^\s*(describe|it|test)(?:\.(?:only|skip|todo|concurrent))?(?:\.each\s*\(.*?\)\s*)?\(\s*(["'`])((?:\\.|(?!\2).)*)\2/.exec(line);
    if (!match) return;
    const name = (match[3] as string).replace(/\\(["'`])/g, "$1");
    if (match[1] === "describe") stack.push({ indent, name });
    else found.push({ name, line: index + 1, parents: stack.map((item) => item.name) });
  });
  return found;
}

async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function dependsOn(pkg: Record<string, unknown> | undefined, name: string): boolean {
  if (!pkg) return false;
  return ["dependencies", "devDependencies", "peerDependencies"].some((key) => {
    const block = pkg[key];
    return typeof block === "object" && block !== null && name in (block as Record<string, unknown>);
  });
}

/**
 * Les suites d'un dossier : Vitest ou Jest s'il en dépend ou a leur configuration,
 * pytest s'il a un `pyproject.toml`, un `pytest.ini` ou un `setup.cfg`. Un dossier
 * sans fichier de test n'a pas de suite.
 */
export async function detectTests(directory: string): Promise<TestSuite[]> {
  const files = await listProjectFiles(directory);
  const suites: TestSuite[] = [];
  const pkg = await readJson(join(directory, "package.json"));
  const hasConfig = (prefix: string) => files.some((file) => new RegExp(`^${prefix}\\.config\\.[cm]?[jt]s$`).test(file));
  const js: Framework | undefined = dependsOn(pkg, "vitest") || hasConfig("vitest")
    ? "vitest"
    : dependsOn(pkg, "jest") || hasConfig("jest")
      ? "jest"
      : undefined;
  if (js) {
    const testFiles = files.filter((file) => JS_TEST.test(file)).sort();
    const read = await Promise.all(
      testFiles.map(async (path) => ({ path, tests: parseTestNames(await readFile(join(directory, path), "utf8").catch(() => ""), js) })),
    );
    if (read.length > 0) suites.push({ framework: js, directory, files: read });
  }
  const python =
    (await exists(join(directory, "pyproject.toml"))) || (await exists(join(directory, "pytest.ini"))) || (await exists(join(directory, "setup.cfg")));
  if (python) {
    const testFiles = files.filter((file) => PY_TEST.test(file)).sort();
    const read = await Promise.all(
      testFiles.map(async (path) => ({ path, tests: parseTestNames(await readFile(join(directory, path), "utf8").catch(() => ""), "pytest") })),
    );
    if (read.length > 0) suites.push({ framework: "pytest", directory, files: read });
  }
  return suites;
}

function toRelative(directory: string, path: string): string {
  const clean = (value: string) => value.replace(/\\/g, "/");
  const base = clean(directory).replace(/\/+$/, "");
  const target = clean(path);
  return target.toLowerCase().startsWith(`${base.toLowerCase()}/`) ? target.slice(base.length + 1) : target;
}

function truncate(text: string): string {
  return text.length > FAILURE_LIMIT ? `${text.slice(0, FAILURE_LIMIT)}…` : text;
}

/**
 * Lit le rapport JSON de Vitest ou de Jest : les deux écrivent
 * `testResults[].assertionResults[]`, avec le fichier en `name`.
 */
export function parseJsonReport(text: string, directory: string): TestResult[] {
  const report = JSON.parse(text) as {
    testResults?: {
      name: string;
      assertionResults?: {
        title: string;
        ancestorTitles?: string[];
        status: string;
        duration?: number | null;
        failureMessages?: string[];
      }[];
    }[];
  };
  return (report.testResults ?? []).flatMap((file) =>
    (file.assertionResults ?? []).map((result) => {
      const status: TestResult["status"] = result.status === "passed" ? "passed" : result.status === "failed" ? "failed" : "skipped";
      const failure = (result.failureMessages ?? []).join("\n").trim();
      return {
        path: toRelative(directory, file.name),
        name: result.title,
        parents: result.ancestorTitles ?? [],
        status,
        ...(typeof result.duration === "number" ? { durationMs: Math.round(result.duration) } : {}),
        ...(status === "failed" && failure ? { failure: truncate(failure) } : {}),
      };
    }),
  );
}

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return match ? decodeXml(match[1] as string) : undefined;
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_all, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");
}

/**
 * Lit le rapport JUnit de pytest (`--junitxml`). Le fichier vient de `file`, ou à
 * défaut de `classname` (`tests.test_x.TestA` → `tests/test_x.py`).
 */
export function parseJunit(text: string): TestResult[] {
  const results: TestResult[] = [];
  const cases = text.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g);
  for (const match of cases) {
    const head = match[1] as string;
    const body = match[3] ?? "";
    const classname = attribute(head, "classname") ?? "";
    const parts = classname.split(".");
    const klass = parts.length > 1 && /^Test/.test(parts[parts.length - 1] as string) ? parts.pop() : undefined;
    const file = attribute(head, "file") ?? `${parts.join("/")}.py`;
    const failed = /<(failure|error)\b/.test(body);
    const skipped = /<skipped\b/.test(body);
    const problem = failed ? /<(?:failure|error)\b([^>]*)>([\s\S]*?)<\/(?:failure|error)>/.exec(body) : null;
    const message = problem ? [attribute(problem[1] ?? "", "message"), decodeXml(problem[2] ?? "")] : null;
    const time = Number(attribute(head, "time"));
    results.push({
      path: file.replace(/\\/g, "/"),
      name: attribute(head, "name") ?? "",
      parents: klass ? [klass] : [],
      status: failed ? "failed" : skipped ? "skipped" : "passed",
      ...(Number.isFinite(time) ? { durationMs: Math.round(time * 1000) } : {}),
      ...(message ? { failure: truncate(message.filter(Boolean).join("\n").trim()) } : {}),
    });
  }
  return results;
}

/** Clé d'un résultat : son fichier, ses blocs et son nom. */
export function resultKey(result: Pick<TestResult, "path" | "name" | "parents">): string {
  return [result.path, ...result.parents, result.name].join(" › ");
}

/**
 * Fusionne un nouveau rapport dans les résultats connus : un test absent du
 * rapport — on n'a lancé qu'un fichier — garde son dernier résultat. Quand on
 * n'a lancé qu'un test (`only`, sa clé), les autres du fichier arrivent
 * « sautés » par le filtre `-t` : ils gardent aussi leur dernier résultat.
 */
export function mergeResults(known: readonly TestResult[], fresh: readonly TestResult[], only?: string): TestResult[] {
  const byKey = new Map(known.map((result) => [resultKey(result), result]));
  for (const result of fresh) {
    const key = resultKey(result);
    if (only !== undefined && key !== only && result.status === "skipped" && byKey.has(key)) continue;
    byKey.set(key, result);
  }
  return [...byKey.values()];
}
