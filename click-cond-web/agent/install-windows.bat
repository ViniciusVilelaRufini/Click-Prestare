@echo off
REM ===================================================================
REM  Click Portaria - Agente Local: instalar / ATUALIZAR
REM  Rode COMO ADMINISTRADOR, na mesma pasta do click-agent.exe.
REM  Instala em %ProgramFiles%\ClickAgente (copia os arquivos para la).
REM
REM  Este script PARA qualquer agente antigo que esteja rodando (e a
REM  tarefa agendada), registra a versao nova e a inicia. Assim voce
REM  nunca fica com duas versoes ao mesmo tempo.
REM ===================================================================
setlocal
set TASK=ClickPortariaAgent
set "SRC=%~dp0"
set "EXE=%SRC%click-agent.exe"
set "DIR=%ProgramFiles%\ClickAgente\"

if not exist "%EXE%" (
  echo [ERRO] click-agent.exe nao encontrado nesta pasta.
  echo Gere o executavel com: npm run build:exe
  pause
  exit /b 1
)

echo.
echo === 1/4  Parando agente antigo (se estiver rodando) ===
REM Para a tarefa agendada e mata QUALQUER processo do agente (exe ou node),
REM senao o Windows nao deixa sobrescrever o .exe (arquivo em uso) e sobram
REM duas versoes ativas. Tem que vir ANTES de reescrever o
REM run-agent-service.cmd: o cmd.exe le o .cmd em execucao pelo deslocamento
REM no arquivo, e reescreve-lo com o laco rodando embaralha os comandos.
schtasks /End /TN "%TASK%" >nul 2>&1
taskkill /F /IM click-agent.exe >nul 2>&1
REM Agente antigo rodando via node (start-agent.cmd): encerra SOMENTE o
REM node.exe cuja linha de comando contem click-agent.cjs - nunca outro
REM node.exe da maquina. O tasklist nao mostra a linha de comando; quem
REM mostra e o Win32_Process (CIM).
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*click-agent.cjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
REM Da um tempo para o Windows liberar o arquivo/porta.
timeout /t 2 /nobreak >nul
REM Instalacao manual substitui qualquer auto-atualizacao pendente: sem
REM isso, o exe instalado agora contaria como "versao nova em teste" e
REM poderia ser revertido para um click-agent.old.exe mais velho.
if exist "%DIR%atualizacao.json" del "%DIR%atualizacao.json"
if exist "%DIR%atualizacao-falhas.txt" del "%DIR%atualizacao-falhas.txt"

REM Pasta do agente: a tarefa roda como SYSTEM, entao so SYSTEM e
REM Administradores podem escrever la - senao qualquer usuario troca o
REM click-agent.exe/run-agent-service.cmd e ganha SYSTEM, ou le o AGENT_TOKEN.
REM Por isso o agente vive numa pasta que ESTE script cria
REM (%ProgramFiles%\ClickAgente) e nunca tranca a pasta de onde foi executado.
REM As linhas do icacls sao IDENTICAS as do instalador do portal
REM (LINHAS_TRANCAR_PASTA_AGENTE em apps/api/src/app/facial/facial.service.ts).
if not exist "%DIR%" mkdir "%DIR%"
icacls "%DIR%." /setowner *S-1-5-32-544 /T /C /Q >nul
icacls "%DIR%." /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F /Q
if errorlevel 1 (
  echo [ERRO] Nao consegui proteger a pasta do agente. Rode este arquivo como Administrador.
  pause
  exit /b 1
)
icacls "%DIR%*" /reset /T /C /Q >nul 2>nul
REM Copia os arquivos DEPOIS de trancar a pasta (o .env com o token nunca fica exposto).
if /I not "%SRC%"=="%DIR%" (
  copy /y "%EXE%" "%DIR%click-agent.exe" >nul
  if exist "%SRC%.env" copy /y "%SRC%.env" "%DIR%.env" >nul
)
if not exist "%DIR%click-agent.exe" (
  echo [ERRO] Nao consegui copiar o click-agent.exe para %DIR%.
  pause
  exit /b 1
)

if not exist "%DIR%.env" (
  echo [AVISO] Arquivo .env nao encontrado. Crie a partir de .env.example
  echo         em %DIR% antes de iniciar, senao o agente nao sobe.
)

echo === 2/4  Registrando tarefa "%TASK%" (inicia com o Windows) ===
REM A tarefa roda um wrapper .cmd (nao o exe direto) para o console do agente
REM ficar gravado em agent-service.log - sem isso o agente roda como SYSTEM e
REM os logs somem, impossibilitando diagnosticar recuperacao offline/enroll.
REM O .cmd tem um laco (":loop" / "goto loop"): se o agente cair (crash,
REM atualizacao) ele volta a subir sozinho - sem o laco, a atualizacao
REM automatica (atualizador.js) nunca troca o exe, porque trocar e sair sem
REM ninguem reiniciar deixaria a maquina sem agente rodando.
REM O bloco abaixo e IDENTICO ao do instalador do portal
REM (getAgentConfigFile em apps/api/src/app/facial/facial.service.ts) e
REM gera exatamente agent/run-agent-service.cmd - um teste confere os tres.
(
echo @echo off
echo cd /d "%%~dp0"
echo:
echo :loop
echo REM Recuperacao: se a atualizacao trocou o exe e o processo morreu no meio
echo REM dos dois renames, so sobra o click-agent.old.exe no disco.
echo if not exist "%%~dp0click-agent.exe" if exist "%%~dp0click-agent.old.exe" ^(
echo   ren "%%~dp0click-agent.old.exe" "click-agent.exe"
echo ^)
echo:
echo REM Sem atualizacao pendente, zera o contador de falhas da versao nova.
echo if not exist "%%~dp0atualizacao.json" if exist "%%~dp0atualizacao-falhas.txt" del "%%~dp0atualizacao-falhas.txt"
echo:
echo REM Rotacao do log: tem que ser AQUI, nao dentro do agente. O ">>" abaixo
echo REM abre o arquivo antes do processo existir e o handle fica em uso
echo REM durante toda a execucao - o proprio agente tentando renomear seu
echo REM stdout herdado falha com EBUSY. Aqui, entre uma execucao e a proxima,
echo REM nenhum processo segura o arquivo.
echo for %%%%A in ^("%%~dp0agent-service.log"^) do if %%%%~zA GTR 5242880 move /y "%%~dp0agent-service.log" "%%~dp0agent-service.1.log" ^>nul
echo:
echo REM Confia no repositorio de certificados do Windows - redes de condominio
echo REM as vezes tem antivirus que inspeciona HTTPS.
echo set "NODE_USE_SYSTEM_CA=1"
echo "%%~dp0click-agent.exe" ^>^> "%%~dp0agent-service.log" 2^>^&1
echo set "SAIDA=%%errorlevel%%"
echo:
echo REM Versao nova que cai ANTES de subir nao chega ao rollback do proprio
echo REM agente. Com atualizacao.json presente, cada saida com erro conta em
echo REM atualizacao-falhas.txt; na 3a, volta o click-agent.old.exe. O
echo REM atualizacao.json fica: o exe antigo, ao subir, marca a versao nova
echo REM como recusada e nao a baixa de novo.
echo if "%%SAIDA%%"=="0" goto espera
echo if not exist "%%~dp0atualizacao.json" goto espera
echo set "FALHAS=0"
echo if exist "%%~dp0atualizacao-falhas.txt" set /p FALHAS=^<"%%~dp0atualizacao-falhas.txt"
echo set /a FALHAS+=1
echo ^>"%%~dp0atualizacao-falhas.txt" echo %%FALHAS%%
echo if %%FALHAS%% LSS 3 goto espera
echo if not exist "%%~dp0click-agent.old.exe" goto espera
echo ^>^>"%%~dp0agent-service.log" echo [servico] versao nova falhou %%FALHAS%%x ao iniciar - voltando para o click-agent.old.exe
echo move /y "%%~dp0click-agent.exe" "%%~dp0click-agent.bad.exe" ^>nul
echo move /y "%%~dp0click-agent.old.exe" "%%~dp0click-agent.exe" ^>nul
echo del "%%~dp0atualizacao-falhas.txt"
echo:
echo :espera
echo REM "timeout" falha na hora sem console de verdade ^(tarefa SYSTEM, sem
echo REM sessao interativa^) e viraria busy-loop; "ping" nao depende de console.
echo ping -n 6 127.0.0.1 ^>nul
echo goto loop
) > "%DIR%run-agent-service.cmd"
schtasks /Create /TN "%TASK%" /TR "\"%DIR%run-agent-service.cmd\"" /SC ONSTART /RU SYSTEM /RL HIGHEST /F
if errorlevel 1 (
  echo [ERRO] Falha ao registrar. Rode este .bat como Administrador.
  pause
  exit /b 1
)
REM O padrao do schtasks mata a tarefa depois de 72h e nao a inicia (ou a
REM para) na bateria - o laco do agente e infinito, entao tira o limite de
REM tempo, libera bateria e reinicia a tarefa sozinha se ela cair.
powershell -NoProfile -Command "Set-ScheduledTask -TaskName ClickPortariaAgent -Settings (New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1))" >nul
if errorlevel 1 echo [AVISO] Nao consegui ajustar as opcoes da tarefa - ela pode parar sozinha apos 72h.

echo === 3/4  Iniciando o agente agora ===
schtasks /Run /TN "%TASK%" >nul 2>&1

echo === 4/4  Conferindo ===
timeout /t 3 /nobreak >nul
tasklist /FI "IMAGENAME eq click-agent.exe" | findstr /I click-agent.exe >nul 2>&1
if errorlevel 1 (
  echo [AVISO] Nao vi o click-agent.exe rodando ainda. Verifique o .env e rode:
  echo         schtasks /Run /TN "%TASK%"
) else (
  echo OK. Agente rodando e configurado para iniciar com o Windows.
)
echo.
echo Ver status:  status-agent.cmd
echo Remover:     schtasks /Delete /TN "%TASK%" /F
pause
