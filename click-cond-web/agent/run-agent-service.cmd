@echo off
REM Laço de reinício (tarefa 9): a tarefa agendada ONSTART/SYSTEM roda ESTE
REM .cmd (não o exe direto), pra sobreviver a crash/atualização sem depender
REM do Windows reiniciar a tarefa sozinho. A auto-atualização (atualizador.js)
REM só troca o exe e sai(0) se este arquivo tiver o laço com "goto loop" ao
REM lado — sem ele, trocar o arquivo e sair NUNCA mais sobe o agente sozinho.
cd /d "%~dp0"

:loop
REM Recuperação: se a atualização trocou o exe e o processo morreu ENTRE os
REM dois renames do atualizador (exe.exe -> .old.exe, .new.exe -> exe.exe),
REM sobra só o .old.exe no disco. Sem isso, o laço ficaria pra sempre sem
REM achar o que rodar.
if not exist "%~dp0click-agent.exe" if exist "%~dp0click-agent.old.exe" (
  ren "%~dp0click-agent.old.exe" "click-agent.exe"
)

REM NODE_USE_SYSTEM_CA=1: o agente fala HTTPS estrito com a nuvem, e redes de
REM condomínio às vezes têm antivírus que inspeciona TLS (troca o
REM certificado do site por um próprio). Sem isso, a cadeia validaria só
REM contra os certificados que vêm embutidos no Node, e a conexão cairia com
REM erro de certificado. Confirmado com o exe SEA de verdade que essa env
REM var É respeitada (mistura a CA do Windows com a embutida do Node).
set "NODE_USE_SYSTEM_CA=1"
"%~dp0click-agent.exe" >> "%~dp0agent-service.log" 2>&1

REM "timeout" falha na hora ("nao ha suporte para o redirecionamento de
REM entrada") sem console de verdade — exatamente o caso aqui: tarefa
REM agendada como SYSTEM, sem sessão interativa, com stdout/stderr
REM redirecionados para o log acima. Sem console, "timeout" sai com erro em
REM vez de esperar, e o laço vira busy-loop (reinicia sem parar, sem
REM esperar). "ping" não depende de console — é o jeito clássico de dar um
REM sleep em .cmd que roda como serviço (confirmado testando os dois nas
REM mesmas condições — ver task-9-report.md).
ping -n 6 127.0.0.1 >nul
goto loop
