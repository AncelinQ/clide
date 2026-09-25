import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { appDataDir } from "@clide/core";

const run = promisify(execFile);

/** Le temps de parcourir l'arborescence ; au-delà, la fenêtre est tenue pour oubliée. */
const PICK_TIMEOUT_MS = 10 * 60 * 1000;

/** Ce que la fenêtre fait choisir. */
export type PickKind = "folder" | "file";

/**
 * Script du sélecteur, exécuté par Windows PowerShell.
 *
 * Pour un dossier, `FolderBrowserDialog` n'offre que l'ancienne arborescence,
 * sans barre d'adresse ni favoris : le script passe par `IFileOpenDialog` en
 * mode dossier, la fenêtre que montre l'Explorateur. Pour un fichier,
 * `OpenFileDialog` montre déjà celle-là. Elle est rattachée à une fenêtre
 * invisible tenue au premier plan, sans quoi elle s'ouvrirait derrière le
 * navigateur qui l'a demandée.
 *
 * Sortie en code 1 sur une annulation, le chemin choisi sur la sortie sinon.
 */
export function pickerScript(): string {
  return `param([string] $Kind = 'folder', [string] $Title = '', [string] $Start = '', [string] $Filter = '')
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace Clide {
  [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")] class FileOpenDialogCoClass {}

  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItem {
    void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
    void GetParent(out IShellItem ppsi);
    void GetDisplayName(uint sigdn, [MarshalAs(UnmanagedType.LPWStr)] out string name);
  }

  // Seules les méthodes jusqu'à GetResult sont appelées : l'ordre de la vtable
  // compte jusque-là, pas au-delà.
  [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IFileOpenDialog {
    [PreserveSig] int Show(IntPtr parent);
    void SetFileTypes(uint count, IntPtr specs);
    void SetFileTypeIndex(uint index);
    void GetFileTypeIndex(out uint index);
    void Advise(IntPtr sink, out uint cookie);
    void Unadvise(uint cookie);
    void SetOptions(uint options);
    void GetOptions(out uint options);
    void SetDefaultFolder(IShellItem item);
    void SetFolder(IShellItem item);
    void GetFolder(out IShellItem item);
    void GetCurrentSelection(out IShellItem item);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string text);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
    void GetResult(out IShellItem item);
  }

  public static class FolderPicker {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    static extern void SHCreateItemFromParsingName(string path, IntPtr pbc, ref Guid riid, out IShellItem item);

    const uint FOS_PICKFOLDERS = 0x20, FOS_FORCEFILESYSTEM = 0x40, FOS_PATHMUSTEXIST = 0x800;
    const uint SIGDN_FILESYSPATH = 0x80058000;

    public static string Pick(IntPtr owner, string title, string start) {
      var dialog = (IFileOpenDialog)new FileOpenDialogCoClass();
      dialog.SetOptions(FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST);
      if (!string.IsNullOrEmpty(title)) dialog.SetTitle(title);
      if (!string.IsNullOrEmpty(start)) {
        try {
          var iid = typeof(IShellItem).GUID;
          IShellItem folder;
          SHCreateItemFromParsingName(start, IntPtr.Zero, ref iid, out folder);
          dialog.SetFolder(folder);
        } catch {
          // Un dossier de départ qui n'existe plus laisse Windows choisir.
        }
      }
      if (dialog.Show(owner) != 0) return null;
      IShellItem result;
      dialog.GetResult(out result);
      string path;
      result.GetDisplayName(SIGDN_FILESYSPATH, out path);
      return path;
    }
  }
}
'@
$owner = New-Object System.Windows.Forms.Form -Property @{
  TopMost = $true; ShowInTaskbar = $false; Opacity = 0; FormBorderStyle = 'None'; StartPosition = 'CenterScreen'
}
$owner.Show()
$owner.Activate()
if ($Kind -eq 'file') {
  $dialog = New-Object System.Windows.Forms.OpenFileDialog
  if ($Title) { $dialog.Title = $Title }
  if ($Filter) { $dialog.Filter = $Filter }
  if ($Start) { $dialog.InitialDirectory = $Start }
  $path = if ($dialog.ShowDialog($owner) -eq 'OK') { $dialog.FileName } else { $null }
} else {
  $path = [Clide.FolderPicker]::Pick($owner.Handle, $Title, $Start)
}
$owner.Close()
if (-not $path) { exit 1 }
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::Out.Write($path)
`;
}

/**
 * Filtre de `OpenFileDialog` : `Fichiers .md|*.md`. Une extension qui ne serait
 * pas faite de lettres et de chiffres casserait sa syntaxe ; elle est refusée.
 */
export function fileFilter(extensions: string[]): string {
  const clean = extensions.map((extension) => extension.replace(/^\./, "").toLowerCase());
  for (const extension of clean) {
    if (!/^[a-z0-9]+$/.test(extension)) throw new Error(`extension invalide : ${extension}`);
  }
  const patterns = clean.map((extension) => `*.${extension}`).join(";");
  return `${clean.map((extension) => `.${extension}`).join(", ")}|${patterns}`;
}

/**
 * Ouvre la fenêtre de sélection de Windows et rend le dossier ou le fichier
 * choisi, ou `undefined` sur une annulation.
 *
 * Le serveur tourne sur le poste de l'utilisateur : la fenêtre s'ouvre sur son
 * écran, ce que la page d'un navigateur ne sait pas faire — elle ne voit jamais
 * le chemin d'un dossier. Titre et dossier de départ passent en arguments du
 * script, jamais dans une ligne de commande recomposée.
 */
export async function pickPath(
  options: { kind?: PickKind; title?: string; start?: string; extensions?: string[] } = {},
  dataDir: string = appDataDir(),
): Promise<string | undefined> {
  const scriptPath = join(dataDir, "picker.ps1");
  await mkdir(dataDir, { recursive: true });
  // Avec BOM : sans lui, Windows PowerShell lit le script dans la page de code
  // du système et abîme les accents du titre.
  await writeFile(scriptPath, `﻿${pickerScript()}`, "utf8");

  const args = ["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-File", scriptPath];
  args.push("-Kind", options.kind ?? "folder");
  if (options.extensions?.length) args.push("-Filter", fileFilter(options.extensions));
  if (options.title) args.push("-Title", options.title);
  if (options.start) args.push("-Start", options.start);
  try {
    const { stdout } = await run("powershell.exe", args, {
      windowsHide: true,
      timeout: PICK_TIMEOUT_MS,
      encoding: "utf8",
    });
    return stdout.trim() || undefined;
  } catch (error) {
    if ((error as { code?: unknown }).code === 1) return undefined;
    throw error;
  }
}
