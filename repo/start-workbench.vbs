' DSH Video Workbench — Zero-Window Silent Background Launcher (Windows WScript)
' Copyright (c) 2026 Merziller (QQ: 1411574209 | WeChat: Merziller | Email: k26789228@gmail.com)
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
repoDir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = repoDir

' Launch Node runner silently (WindowStyle = 0 -> completely hidden, no black CMD window!)
cmd = "node """ & repoDir & "\scripts\dsh-runner.mjs"" video --keep-alive --open --daemon"
sh.Run cmd, 0, False
