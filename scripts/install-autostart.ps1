<#
.SYNOPSIS
  Installe ou retire le démarrage automatique de Loupedeck HA à l'ouverture de session.

.DESCRIPTION
  -Install   crée la tâche planifiée « Loupedeck HA », déclenchée à l'ouverture de session de
             l'utilisateur courant ; elle lance scripts\launch-hidden.vbs (node dist\main.js, sans fenêtre).
  -Uninstall supprime cette tâche.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Install
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory, ParameterSetName = 'Install')][switch]$Install,
  [Parameter(Mandatory, ParameterSetName = 'Uninstall')][switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$TaskName = 'Loupedeck HA'
$repo = Split-Path -Parent $PSScriptRoot
$vbs = Join-Path $PSScriptRoot 'launch-hidden.vbs'

if ($Install) {
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
else {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Tâche « $TaskName » supprimée."
  }
  else {
    Write-Host "Aucune tâche « $TaskName » à supprimer."
  }
}
