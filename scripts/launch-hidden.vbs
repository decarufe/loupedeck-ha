' Loupedeck HA : lance "node dist\main.js" sans fenetre, depuis la racine du depot.
' Utilise par la tache planifiee "Loupedeck HA" (voir install-autostart.ps1).
'
' Relance automatique : tant que node sort avec un code different de 0 (plantage, exception
' non rattrapee), on attend 5 s puis on relance. Une sortie volontaire (code 0 : Ctrl+C,
' SIGINT ou SIGTERM geres par main.ts) arrete la boucle.
'
' Arguments facultatifs, reserves aux tests : 1) script a lancer a la place de dist\main.js,
' 2) pause entre deux lancements, en millisecondes.
Option Explicit

Dim fso, shell, repo, script, pauseMs, code
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

repo = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
shell.CurrentDirectory = repo

script = repo & "\dist\main.js"
pauseMs = 5000
If WScript.Arguments.Count >= 1 Then script = WScript.Arguments(0)
If WScript.Arguments.Count >= 2 Then pauseMs = CLng(WScript.Arguments(1))

Do
  code = shell.Run("node """ & script & """", 0, True)
  If code = 0 Then Exit Do
  WScript.Sleep pauseMs
Loop
