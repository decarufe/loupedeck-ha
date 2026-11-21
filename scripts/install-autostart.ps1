<#
.SYNOPSIS
  Installe ou retire le démarrage automatique de Loupedeck HA et les raccourcis vers l'éditeur.

.DESCRIPTION
  -Install   crée la tâche planifiée « Loupedeck HA », déclenchée à l'ouverture de session de
             l'utilisateur courant ; elle lance scripts\launch-hidden.vbs (node dist\main.js, sans fenêtre).
             Crée aussi le raccourci « Loupedeck HA – Configuration.url » sur le Bureau et dans le menu
             Démarrer ; il ouvre l'éditeur sur http://127.0.0.1:<port>/ (port lu dans
             %APPDATA%\loupedeck-ha\config.json, editor.port, sinon 8765 ; le jeton n'est jamais affiché).
  -Uninstall supprime la tâche et les deux raccourcis.
  -ShortcutsOnly ne gère que les raccourcis (pas de tâche planifiée) ; utilisé par les tests.
  -DesktopDir / -StartMenuDir / -ConfigPath redirigent les emplacements (tests).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Install
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory, ParameterSetName = 'Install')][switch]$Install,
  [Parameter(Mandatory, ParameterSetName = 'Uninstall')][switch]$Uninstall,
  [switch]$ShortcutsOnly,
  [string]$DesktopDir,
  [string]$StartMenuDir,
  [string]$ConfigPath
)

$ErrorActionPreference = 'Stop'
$TaskName = 'Loupedeck HA'
$DefaultPort = 8765
$repo = Split-Path -Parent $PSScriptRoot
$vbs = Join-Path $PSScriptRoot 'launch-hidden.vbs'
$ShortcutName = "Loupedeck HA $([char]0x2013) Configuration.url"

if (-not $DesktopDir) { $DesktopDir = [Environment]::GetFolderPath('Desktop') }
if (-not $StartMenuDir) { $StartMenuDir = [Environment]::GetFolderPath('Programs') }
if (-not $ConfigPath) { $ConfigPath = Join-Path $env:APPDATA 'loupedeck-ha\config.json' }

function Get-EditorPort {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return $DefaultPort }
  try {
    $cfg = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
    $port = $cfg.editor.port
    if ($port -is [int] -or $port -is [long] -or $port -is [double]) {
      if ($port -eq [math]::Floor($port) -and $port -ge 1 -and $port -le 65535) { return [int]$port }
    }
  }
  catch { }
  return $DefaultPort
}

function New-EditorShortcuts {
  $port = Get-EditorPort -Path $ConfigPath
  $content = "[InternetShortcut]`r`nURL=http://127.0.0.1:$port/`r`nIconFile=%SystemRoot%\System32\shell32.dll`r`nIconIndex=13`r`n"
  foreach ($dir in @($DesktopDir, $StartMenuDir)) {
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $file = Join-Path $dir $ShortcutName
    [System.IO.File]::WriteAllText($file, $content, [System.Text.Encoding]::ASCII)
    Write-Host "Raccourci créé : $file (http://127.0.0.1:$port/)"
  }
}

function Remove-EditorShortcuts {
  foreach ($dir in @($DesktopDir, $StartMenuDir)) {
    $file = Join-Path $dir $ShortcutName
    if (Test-Path -LiteralPath $file) {
      Remove-Item -LiteralPath $file -Force
      Write-Host "Raccourci supprimé : $file"
    }
    else {
      Write-Host "Aucun raccourci à supprimer : $file"
    }
  }
}

if ($Install) {
  if (-not $ShortcutsOnly) {
    if (-not (Test-Path (Join-Path $repo 'dist\main.js'))) {
      throw "dist\main.js introuvable : lancez d'abord « pnpm run build » à la racine du dépôt."
    }
    $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbs`"" -WorkingDirectory $repo
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
      -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal `
      -Settings $settings -Description 'Loupedeck Live comme télécommande Home Assistant' -Force | Out-Null
    Write-Host "Tâche « $TaskName » installée : l'application démarrera à la prochaine ouverture de session."
    Write-Host "Pour la lancer tout de suite : Start-ScheduledTask -TaskName '$TaskName'"
  }
  New-EditorShortcuts
}
else {
  if (-not $ShortcutsOnly) {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
      Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
      Write-Host "Tâche « $TaskName » supprimée."
    }
    else {
      Write-Host "Aucune tâche « $TaskName » à supprimer."
    }
  }
  Remove-EditorShortcuts
}
