<#
.SYNOPSIS
  Test de install-autostart.ps1 -ShortcutsOnly dans des dossiers temporaires (aucune tâche planifiée,
  ni Bureau ni menu Démarrer réels).
  Usage : powershell -ExecutionPolicy Bypass -File scripts\test-shortcuts.ps1
#>
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'install-autostart.ps1'
$root = Join-Path ([IO.Path]::GetTempPath()) ("lpdk-shortcut-test-" + [guid]::NewGuid())
$desk = Join-Path $root 'Desktop'
$menu = Join-Path $root 'Programs'
$cfg = Join-Path $root 'config.json'
$name = "Loupedeck HA $([char]0x2013) Configuration.url"
$fail = 0
function Check($ok, $msg) {
  if ($ok) { Write-Host "OK    $msg" } else { Write-Host "ECHEC $msg"; $script:fail++ }
}
function Run($flag) {
  $sw = @{ ($flag.TrimStart('-')) = $true }
  & $script @sw -ShortcutsOnly -DesktopDir $desk -StartMenuDir $menu -ConfigPath $cfg | Out-Null
}
function Url($dir) { Get-Content -LiteralPath (Join-Path $dir $name) -Raw }

try {
  New-Item -ItemType Directory -Path $root | Out-Null
  # 1. pas de config : port par défaut
  Run '-Install'
  foreach ($d in $desk, $menu) {
    Check (Test-Path -LiteralPath (Join-Path $d $name)) "raccourci créé dans $(Split-Path -Leaf $d)"
    $u = Url $d
    Check ($u -match '(?m)^\[InternetShortcut\]') "[InternetShortcut] présent"
    Check ($u -match '(?m)^URL=http://127\.0\.0\.1:8765/\s*$') "port par défaut 8765"
    Check ($u -match 'IconFile=.*shell32\.dll' -and $u -match 'IconIndex=13') "icône générique"
  }
  # 2. config valide avec jeton (ne doit jamais apparaître)
  '{"version":1,"ha":{"token":"SECRET-TOKEN"},"editor":{"port":9123}}' | Set-Content -LiteralPath $cfg -Encoding UTF8
  $out = & $script -Install -ShortcutsOnly -DesktopDir $desk -StartMenuDir $menu -ConfigPath $cfg | Out-String
  Check ((Url $desk) -match 'URL=http://127\.0\.0\.1:9123/') "port lu dans config.json (9123)"
  Check (-not ($out -match 'SECRET' -or (Url $desk) -match 'SECRET')) "jeton absent de la sortie et du .url"
  # 3. ports invalides : retour à 8765
  foreach ($bad in '{"editor":{"port":0}}', '{"editor":{"port":70000}}', '{"editor":{"port":"80"}}', '{"editor":{"port":1.5}}', 'pas du json') {
    $bad | Set-Content -LiteralPath $cfg -Encoding UTF8
    Run '-Install'
    Check ((Url $desk) -match 'URL=http://127\.0\.0\.1:8765/') "port invalide ignoré : $bad"
  }
  # 4. désinstallation, puis une seconde fois sans erreur
  Run '-Uninstall'
  Check (-not (Test-Path -LiteralPath (Join-Path $desk $name)) -and -not (Test-Path -LiteralPath (Join-Path $menu $name))) "raccourcis supprimés"
  try { Run '-Uninstall'; Check $true "désinstallation répétée sans erreur" } catch { Check $false "désinstallation répétée : $_" }
}
finally { Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue }
if ($fail) { Write-Host "$fail échec(s)"; exit 1 } else { Write-Host "Tous les tests passent."; exit 0 }
