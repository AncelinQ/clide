import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { appDataDir } from "@claude-ide/core";

import { attachmentsDir } from "./attachments.js";

const run = promisify(execFile);

/** Le temps de choisir une zone de l'écran, et un peu plus. */
export const CAPTURE_TIMEOUT_S = 120;

/**
 * Script de capture, exécuté par Windows PowerShell.
 *
 * L'outil Capture d'écran de Windows (`ms-screenclip:`) dépose sa capture dans le
 * presse-papiers, pas dans un fichier. Le script relève le compteur de séquence du
 * presse-papiers avant de l'ouvrir, puis attend qu'il change avec une image : une
 * image déjà présente n'est pas prise pour la capture, et une annulation laisse
 * le compteur tel quel jusqu'au délai. Rien n'est écrit dans le presse-papiers.
 *
 * Windows PowerShell plutôt que pwsh : `System.Windows.Forms` y est toujours là, et
 * le presse-papiers demande un thread STA.
 */
export function captureScript(): string {
  return `param([string] $Out, [int] $Timeout = ${CAPTURE_TIMEOUT_S})
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -Namespace ClaudeIde -Name Clipboard -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();'
$before = [ClaudeIde.Clipboard]::GetClipboardSequenceNumber()
Start-Process 'ms-screenclip:'
$deadline = (Get-Date).AddSeconds($Timeout)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 300
  if ([ClaudeIde.Clipboard]::GetClipboardSequenceNumber() -ne $before -and [System.Windows.Forms.Clipboard]::ContainsImage()) {
    $image = [System.Windows.Forms.Clipboard]::GetImage()
    $image.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output $Out
    exit 0
  }
}
exit 2
`;
}

function stamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/**
 * Lance une capture interactive et rend le chemin de l'image, ou refuse si rien
 * n'a été capturé dans le délai.
 *
 * Le chemin passe en argument d'un script écrit sur le disque, jamais dans une
 * ligne de commande recomposée.
 */
export async function captureScreen(dataDir: string = appDataDir()): Promise<string> {
  const scriptPath = join(dataDir, "capture.ps1");
  await mkdir(dataDir, { recursive: true });
  await writeFile(scriptPath, captureScript(), "utf8");

  const directory = attachmentsDir(dataDir);
  await mkdir(directory, { recursive: true });
  const out = join(directory, `${stamp(new Date())}-capture.png`);

  try {
    await run(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-Out", out],
      { windowsHide: true, timeout: (CAPTURE_TIMEOUT_S + 10) * 1000 },
    );
  } catch (error) {
    if ((error as { code?: unknown }).code === 2) throw new Error("aucune capture dans le délai");
    throw error;
  }
  return out;
}
