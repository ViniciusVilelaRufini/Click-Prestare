@echo off
cd /d "%~dp0"

:loop
REM Recuperacao: se a atualizacao trocou o exe e o processo morreu no meio
REM dos dois renames, so sobra o click-agent.old.exe no disco.
if not exist "%~dp0click-agent.exe" if exist "%~dp0click-agent.old.exe" (
  ren "%~dp0click-agent.old.exe" "click-agent.exe"
)

REM Sem atualizacao pendente, zera o contador de falhas da versao nova.
if not exist "%~dp0atualizacao.json" if exist "%~dp0atualizacao-falhas.txt" del "%~dp0atualizacao-falhas.txt"

REM Rotacao do log: tem que ser AQUI, nao dentro do agente. O ">>" abaixo
REM abre o arquivo antes do processo existir e o handle fica em uso
REM durante toda a execucao - o proprio agente tentando renomear seu
REM stdout herdado falha com EBUSY. Aqui, entre uma execucao e a proxima,
REM nenhum processo segura o arquivo.
for %%A in ("%~dp0agent-service.log") do if %%~zA GTR 5242880 move /y "%~dp0agent-service.log" "%~dp0agent-service.1.log" >nul

REM Confia no repositorio de certificados do Windows - redes de condominio
REM as vezes tem antivirus que inspeciona HTTPS.
set "NODE_USE_SYSTEM_CA=1"
"%~dp0click-agent.exe" >> "%~dp0agent-service.log" 2>&1
set "SAIDA=%errorlevel%"

REM Versao nova que cai ANTES de subir nao chega ao rollback do proprio
REM agente. Com atualizacao.json presente, cada saida com erro conta em
REM atualizacao-falhas.txt; na 3a, volta o click-agent.old.exe. O
REM atualizacao.json fica: o exe antigo, ao subir, marca a versao nova
REM como recusada e nao a baixa de novo.
if "%SAIDA%"=="0" goto espera
if not exist "%~dp0atualizacao.json" goto espera
set "FALHAS=0"
if exist "%~dp0atualizacao-falhas.txt" set /p FALHAS=<"%~dp0atualizacao-falhas.txt"
set /a FALHAS+=1
>"%~dp0atualizacao-falhas.txt" echo %FALHAS%
if %FALHAS% LSS 3 goto espera
if not exist "%~dp0click-agent.old.exe" goto espera
>>"%~dp0agent-service.log" echo [servico] versao nova falhou %FALHAS%x ao iniciar - voltando para o click-agent.old.exe
move /y "%~dp0click-agent.exe" "%~dp0click-agent.bad.exe" >nul
move /y "%~dp0click-agent.old.exe" "%~dp0click-agent.exe" >nul
del "%~dp0atualizacao-falhas.txt"

:espera
REM "timeout" falha na hora sem console de verdade (tarefa SYSTEM, sem
REM sessao interativa) e viraria busy-loop; "ping" nao depende de console.
ping -n 6 127.0.0.1 >nul
goto loop
