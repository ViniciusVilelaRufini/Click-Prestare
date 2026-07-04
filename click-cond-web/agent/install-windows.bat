@echo off
REM ===================================================================
REM  Click Portaria - Agente Local: instalar / ATUALIZAR
REM  Rode COMO ADMINISTRADOR, na mesma pasta do click-agent.exe.
REM
REM  Este script PARA qualquer agente antigo que esteja rodando (e a
REM  tarefa agendada), registra a versao nova e a inicia. Assim voce
REM  nunca fica com duas versoes ao mesmo tempo.
REM ===================================================================
setlocal
set TASK=ClickPortariaAgent
set EXE=%~dp0click-agent.exe

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
REM duas versoes ativas.
schtasks /End /TN "%TASK%" >nul 2>&1
taskkill /F /IM click-agent.exe >nul 2>&1
for /f "tokens=2" %%p in ('tasklist /FI "IMAGENNAME eq node.exe" /V /FO LIST 2^>nul ^| findstr /I "index.js"') do taskkill /F /PID %%p >nul 2>&1
REM Da um tempo para o Windows liberar o arquivo/porta.
timeout /t 2 /nobreak >nul

if not exist "%~dp0.env" (
  echo [AVISO] Arquivo .env nao encontrado. Crie a partir de .env.example
  echo         antes de iniciar, senao o agente nao sobe.
)

echo === 2/4  Registrando tarefa "%TASK%" (inicia com o Windows) ===
REM A tarefa roda um wrapper .cmd (nao o exe direto) para o console do agente
REM ficar gravado em agent-service.log — sem isso o agente roda como SYSTEM e
REM os logs somem, impossibilitando diagnosticar recuperacao offline/enroll.
(
echo @echo off
echo cd /d "%%~dp0"
echo "%%~dp0click-agent.exe" ^>^> "%%~dp0agent-service.log" 2^>^&1
) > "%~dp0run-agent-service.cmd"
schtasks /Create /TN "%TASK%" /TR "\"%~dp0run-agent-service.cmd\"" /SC ONSTART /RU SYSTEM /RL HIGHEST /F
if errorlevel 1 (
  echo [ERRO] Falha ao registrar. Rode este .bat como Administrador.
  pause
  exit /b 1
)

echo === 3/4  Iniciando o agente agora ===
schtasks /Run /TN "%TASK%" >nul 2>&1

echo === 4/4  Conferindo ===
timeout /t 3 /nobreak >nul
tasklist /FI "IMAGENNAME eq click-agent.exe" | findstr /I click-agent.exe >nul 2>&1
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
