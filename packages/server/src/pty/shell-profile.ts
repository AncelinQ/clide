import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { LINKS_PROMPT, appDataDir } from "@claude-ide/core";

import { OSC_CODE } from "./osc.js";

/**
 * Segments du fichier de prompt, cités pour `Join-Path`.
 *
 * Le chemin est recomposé par le shell plutôt qu'écrit tel quel : sur Windows il
 * contient un séparateur qui n'a pas sa place dans ce fichier.
 */
const PROMPT_SEGMENTS = LINKS_PROMPT.split(/[\\/]/)
  .map((segment) => `'${segment}'`)
  .join(" ");

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

# L'exécutable est résolu une fois, avant que la fonction du même nom existe :
# appelé par son nom depuis cette fonction, il s'appellerait elle. Sans
# exécutable trouvé, aucune fonction n'est posée et la commande échoue comme
# elle l'aurait fait sans nous.
$global:__claudeIdeClaude = (
  Get-Command claude -CommandType Application, ExternalScript -ErrorAction SilentlyContinue |
    Select-Object -First 1
).Source

if ($global:__claudeIdeClaude) {
  function global:claude {
    $promptFile = Join-Path $PWD.Path ${PROMPT_SEGMENTS}

    # Le drapeau refuse de démarrer sur un fichier absent, et un appel qui pose
    # déjà son propre prompt système garde la main sur ce qu'il a demandé.
    $own = @($args) -match '^--(append-)?system-prompt(-file)?$'

    # L'onglet passe en mode Claude le temps de la session, avec la ligne de
    # commande pour reconnaître une reprise. Les caractères de contrôle sont
    # retirés : un BEL dans un argument fermerait la séquence avant son terme.
    $line = -join (('claude ' + ($args -join ' ')).ToCharArray() | Where-Object { [int] $_ -ge 32 })
    __claudeIdeEmit ('CLAUDE_START;' + $line)
    try {
      if ((Test-Path -LiteralPath $promptFile -PathType Leaf) -and $own.Count -eq 0) {
        & $global:__claudeIdeClaude --append-system-prompt-file $promptFile @args
      } else {
        & $global:__claudeIdeClaude @args
      }
    } finally {
      __claudeIdeEmit 'CLAUDE_END'
    }
  }
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
