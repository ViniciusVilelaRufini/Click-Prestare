' Lança o Agente Local (Click Portaria) SEM janela de console.
' Coloque este arquivo e o start-agent.cmd na mesma pasta do agente.
' Para auto-start ao logon: crie um atalho para este .vbs em:
'   shell:startup  (só o usuário atual)
'   shell:common startup  (todos os usuários)
Dim scriptDir
scriptDir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
Set sh = CreateObject("WScript.Shell")
sh.Run """" & scriptDir & "start-agent.cmd""", 0, False
