import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { appDataDir } from "@claude-ide/core";

import { OSC_CODE } from "./osc.js";

/**
 * Profil PowerShell injecté dans les terminaux de l'application.
 *
 * Deux principes.
 *
 * Il **chaîne** le prompt existant au lieu de le remplacer : la fonction en
 * place est capturée puis rappelée, pour qu'un oh-my-posh ou un starship
 * survive à l'injection. Le shell démarre donc sans `-NoProfile`, afin que le
 * profil de l'utilisateur se charge d'abord.
 *
 * Il ne contient **aucune barre oblique inverse** : les caractères de contrôle
 * sont construits par `[char]27` et `[char]7`. Tout échappement traversant le
 * générateur, le fichier et l'analyseur PowerShell finit par se perdre en route.
 */
export function shellProfileScript(oscCode: number = OSC_CODE): string {
  return `# claude-ide — intégration shell. Fichier généré, toute modification sera écrasée.

if (-not $global:__claudeIdeInner) {
  $global:__claudeIdeInner = $function:prompt
}

function global:__claudeIdeEmit([string] $payload) {
  [Console]::Write([char]27 + ']${oscCode};' + $payload + [char]7)
}

function global:prompt {
  # $? doit être lu avant toute autre commande, sinon il décrit cette lecture.
  $ok = $?
  $native = $global:LASTEXITCODE
  $code = if ($ok) { 0 } elseif ($native -is [int] -and $native -ne 0) { $native } else { 1 }

  try {
    $uri = ([uri] $PWD.Path).AbsoluteUri
    [Console]::Write([char]27 + ']7;' + $uri + [char]7)
  } catch {
    # Un fournisseur non-fichier (Cert:, HKLM:) n'a pas d'URI : pas de dossier à signaler.
  }

  __claudeIdeEmit ('END;' + $code)

  if ($global:__claudeIdeInner) { & $global:__claudeIdeInner } else { 'PS ' + $PWD.Path + '> ' }
}

# Marqueur de début de commande. PSReadLine peut être absent ou déjà pourvu d'un
# gestionnaire : l'échec est sans conséquence, l'état « en cours » se déduit alors
# du prochain END.
try {
  Set-PSReadLineKeyHandler -Key Enter -ScriptBlock {
    param($key, $arg)
    __claudeIdeEmit 'START'
    [Microsoft.PowerShell.PSConsoleReadLine]::AcceptLine()
  }
} catch {
}
`;
}

export interface ShellProfile {
  path: string;
  /** Arguments à passer à `pwsh`, profil utilisateur compris. */
  args: string[];
}

export function profilePath(dataDir: string = appDataDir()): string {
  return join(dataDir, "pwsh", "claude-ide-profile.ps1");
}

/**
 * Écrit le profil et rend la ligne de commande du shell.
 *
 * `-NoProfile` est volontairement absent : le profil de l'utilisateur se charge
 * en premier, le nôtre se greffe ensuite.
 */
export async function installShellProfile(dataDir: string = appDataDir()): Promise<ShellProfile> {
  const path = profilePath(dataDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, shellProfileScript(), "utf8");
  return { path, args: ["-NoLogo", "-NoExit", "-Command", `. '${path.replace(/'/g, "''")}'`] };
}
