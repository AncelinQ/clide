import { describe, expect, it } from "vitest";

import { changeTree, filesUnder, type ChangeDir } from "../src/lib/change-tree";

type Change = { path: string };

/** L'arbre en lignes indentées, dossiers suivis d'une barre. */
function lines(dir: ChangeDir<Change>, depth = 0): string[] {
  const pad = "  ".repeat(depth);
  return [
    ...dir.dirs.flatMap((child) => [`${pad}${child.name}/`, ...lines(child, depth + 1)]),
    ...dir.files.map((file) => `${pad}${file.path.slice(file.path.lastIndexOf("/") + 1)}`),
  ];
}

describe("changeTree", () => {
  it("range par dossier, fusionne les dossiers à enfant unique, dossiers d'abord", () => {
    const tree = changeTree([
      { path: "README.md" },
      { path: "packages/web/src/components/b.tsx" },
      { path: "packages/web/src/components/a.tsx" },
      { path: "packages/web/src/lib/x.ts" },
      { path: "packages/server/src/y.ts" },
      { path: "docs/guide.md" },
    ]);
    expect(lines(tree)).toEqual([
      "docs/",
      "  guide.md",
      "packages/",
      "  server/src/",
      "    y.ts",
      "  web/src/",
      "    components/",
      "      a.tsx",
      "      b.tsx",
      "    lib/",
      "      x.ts",
      "README.md",
    ]);
  });

  it("garde le chemin complet d'un dossier fusionné, et liste ce qu'il contient", () => {
    const tree = changeTree([{ path: "a/b/c/f.ts" }, { path: "a/b/c/g.ts" }]);
    const [dir] = tree.dirs;
    expect(dir?.name).toBe("a/b/c");
    expect(dir?.path).toBe("a/b/c");
    expect(filesUnder(tree).map((file) => file.path)).toEqual(["a/b/c/f.ts", "a/b/c/g.ts"]);
  });
});
