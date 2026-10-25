' GW auto-link watcher launcher: runs gw-watch.ps1 (same folder) with no window.
' Put a shortcut to this file in the Startup folder (Win+R -> shell:startup) so it starts with Windows.
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & dir & "\gw-watch.ps1""", 0, False
