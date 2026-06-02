Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.Run Chr(34) & dir & "\BuildProPOS.exe" & Chr(34), 0, False
Set fso = Nothing
Set WshShell = Nothing