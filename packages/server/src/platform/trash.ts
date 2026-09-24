import { execFile } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { appDataDir } from "@clide/core";

const run = promisify(execFile);

/**
 * Script de mise à la corbeille, exécuté par Windows PowerShell.
 *
 * `Microsoft.VisualBasic.FileIO.FileSystem` est la seule voie .NET vers la
 * corbeille : elle y range fichiers et dossiers comme l'Explorateur, d'où l'on
 * peut les restaurer. Les chemins arrivent en arguments, un par un, jamais dans
 * une ligne de commande recomposée.
 */
export function trashScript(): string {
  return `param([Parameter(ValueFromRemainingArguments = $true)] [string[]] $Paths)
Add-Type -AssemblyName Microsoft.VisualBasic
$ErrorActionPreference = 'Stop'
foreach ($path in $Paths) {
  if (Test-Path -LiteralPath $path -PathType Container) {
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($path, 'OnlyErrorDialogs', 'SendToRecycleBin')
  } elseif (Test-Path -LiteralPath $path -PathType Leaf) {
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($path, 'OnlyErrorDialogs', 'SendToRecycleBin')
  }
}
`;
}

/** Met des fichiers et dossiers à la corbeille de Windows, d'où ils se restaurent. */
export async function moveToRecycleBin(paths: string[], dataDir: string = appDataDir()): Promise<void> {
  if (paths.length === 0) return;
  const scriptPath = join(dataDir, "trash.ps1");
  await mkdir(dataDir, { recursive: true });
  await writeFile(scriptPath, trashScript(), "utf8");
  await run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...paths],
    { windowsHide: true, timeout: 60_000 },
  );
  // La corbeille ne rend pas d'erreur fiable : c'est l'absence qui fait foi.
  for (const path of paths) {
    const still = await stat(path).then(
      () => true,
      () => false,
    );
    if (still) throw new Error(`${path} n'a pas pu être mis à la corbeille`);
  }
}
