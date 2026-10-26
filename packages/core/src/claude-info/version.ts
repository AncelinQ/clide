const VERSION = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/;

interface Parsed {
  numbers: [number, number, number];
  pre: string;
}

function parse(version: string): Parsed | undefined {
  const match = VERSION.exec(version.trim());
  if (!match) return undefined;
  return { numbers: [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)], pre: match[4] ?? "" };
}

/** `2.1.283 (Claude Code)` → `2.1.283`. Une sortie qui ne commence pas par `x.y.z` ne donne rien. */
export function parseClaudeVersion(output: string): string | undefined {
  const token = output.trim().split(/\s+/)[0] ?? "";
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(token) ? token : undefined;
}

/**
 * -1, 0 ou 1. Une pré-version passe avant sa version ; une version illisible
 * passe avant toutes les autres.
 */
export function compareVersions(a: string, b: string): number {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return x ? 1 : y ? -1 : 0;
  for (const [index, number] of x.numbers.entries()) {
    const other = y.numbers[index] ?? 0;
    if (number !== other) return number < other ? -1 : 1;
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre || !y.pre) return x.pre ? -1 : 1;
  return x.pre < y.pre ? -1 : 1;
}

/** La dernière version publiée, quand elle est plus récente que celle installée. */
export function newerVersion(installed: string | undefined, latest: string | undefined): string | undefined {
  if (!installed || !latest) return undefined;
  return compareVersions(latest, installed) > 0 ? latest : undefined;
}
