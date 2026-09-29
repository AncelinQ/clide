import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Version de la prochaine release : le dernier tag `v*` + 1 patch, ou la
 * version de `package.json` quand elle est plus haute. Une version mineure ou
 * majeure se décide donc en montant `package.json` ; la CI ne committe rien.
 *
 * Usage en CI : `node scripts/next-version.mjs` → affiche par exemple 0.1.3
 */

const parse = (v) => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  return m ? [+m[1], +m[2], +m[3]] : null;
};
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/**
 * @param {string[]} tags tags du dépôt ; ceux qui ne sont pas des versions sont ignorés
 * @param {string} pkgVersion version déclarée dans `package.json`
 */
export function nextVersion(tags, pkgVersion) {
  const pkg = parse(pkgVersion);
  if (!pkg) throw new Error(`version de package.json invalide : ${pkgVersion}`);
  const released = tags.map(parse).filter(Boolean).sort(cmp).pop();
  if (!released) return pkg.join(".");
  const patch = [released[0], released[1], released[2] + 1];
  return (cmp(pkg, released) > 0 ? pkg : patch).join(".");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const here = join(dirname(fileURLToPath(import.meta.url)), "..");
  const tags = execFileSync("git", ["tag", "--list", "v*"], { cwd: here, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  const { version } = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));
  console.log(nextVersion(tags, version));
}
