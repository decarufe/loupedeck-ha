' Loupedeck HA : lance "node dist\main.js" sans fenetre, depuis la racine du depot.
' Utilise par la tache planifiee "Loupedeck HA" (voir install-autostart.ps1).
Option Explicit

Dim fso, shell, repo
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

repo = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
shell.CurrentDirectory = repo
shell.Run "node """ & repo & "\dist\main.js""", 0, False
