import { execFile, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { appDataDir } from "@clide/core";

import { attachmentsDir } from "./attachments.js";

/** Le temps de choisir une zone de l'écran, et un peu plus. */
export const CAPTURE_TIMEOUT_S = 120;

/**
 * Script de capture, exécuté par Windows PowerShell.
 *
 * L'outil Capture d'écran de Windows (`ms-screenclip:`) dépose sa capture dans le
 * presse-papiers, pas dans un fichier. Le script relève le compteur de séquence du
 * presse-papiers avant de l'ouvrir, puis attend qu'il change avec une image : une
 * image déjà présente n'est pas prise pour la capture. Rien n'est écrit dans le
 * presse-papiers.
 *
 * Une annulation ne dépose rien : pour ne pas attendre le délai, le script suit
 * les processus de l'outil apparus après son ouverture, et sort en code 3 quand
 * ils ont tous disparu sans qu'une image soit arrivée. Un outil qui reste en
 * mémoire après coup n'est jamais pris pour une annulation : il faut alors
 * annuler depuis l'application.
 *
 * Windows PowerShell plutôt que pwsh : `System.Windows.Forms` y est toujours là, et
 * le presse-papiers demande un thread STA.
 */
export function captureScript(): string {
  return `param([string] $Out, [int] $Timeout = ${CAPTURE_TIMEOUT_S})
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -Namespace Clide -Name Clipboard -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();'
$tools = 'ScreenClippingHost', 'SnippingTool'
$known = @(Get-Process -Name $tools -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
$before = [Clide.Clipboard]::GetClipboardSequenceNumber()
Start-Process 'ms-screenclip:'
$deadline = (Get-Date).AddSeconds($Timeout)
$seen = @{}
$goneSince = $null
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 300
  if ([Clide.Clipboard]::GetClipboardSequenceNumber() -ne $before -and [System.Windows.Forms.Clipboard]::ContainsImage()) {
    $image = [System.Windows.Forms.Clipboard]::GetImage()
    $image.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output $Out
    exit 0
  }
  $alive = @(Get-Process -Name $tools -ErrorAction SilentlyContinue | Where-Object { $known -notcontains $_.Id } | ForEach-Object { $_.Id })
  foreach ($id in $alive) { $seen[$id] = $true }
  if ($seen.Count -gt 0 -and $alive.Count -eq 0) {
    # Un temps de grâce : l'image peut arriver juste après la fermeture de l'outil.
    if (-not $goneSince) { $goneSince = Get-Date }
    elseif (((Get-Date) - $goneSince).TotalMilliseconds -gt 1500) { exit 3 }
  } else {
    $goneSince = $null
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

  if (running) throw new Error("une capture est déjà en cours");
  await new Promise<void>((resolve, reject) => {
    const child = execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-Out", out],
      { windowsHide: true, timeout: (CAPTURE_TIMEOUT_S + 10) * 1000 },
      (error) => {
        running = undefined;
        if (!error) return resolve();
        const { code, killed } = error as { code?: unknown; killed?: boolean };
        if (code === 3 || killed) return reject(new CaptureCancelled());
        if (code === 2) return reject(new Error("aucune capture dans le délai"));
        reject(error);
      },
    );
    running = child;
  });
  return out;
}

/** Capture en cours, qu'on peut interrompre. */
let running: ChildProcess | undefined;

/** Annulée par l'utilisateur, dans l'outil ou depuis l'application : ce n'est pas une erreur. */
export class CaptureCancelled extends Error {
  constructor() {
    super("capture annulée");
  }
}

/** Interrompt la capture en cours, s'il y en a une. */
export function cancelCapture(): boolean {
  if (!running) return false;
  running.kill();
  return true;
}
