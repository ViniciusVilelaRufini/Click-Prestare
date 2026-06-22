@echo off
REM ===================================================================
REM  Click Portaria - Agente Local: instalar para iniciar com o Windows
REM  Rode este arquivo COMO ADMINISTRADOR, na mesma pasta do click-agent.exe
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

if not exist "%~dp0.env" (
  echo [AVISO] Arquivo .env nao encontrado. Crie a partir de .env.example
  echo         antes de iniciar, senao o agente nao sobe.
)

echo Registrando tarefa "%TASK%" para iniciar com o Windows...
schtasks /Create /TN "%TASK%" /TR "\"%EXE%\"" /SC ONSTART /RU SYSTEM /RL HIGHEST /F
if errorlevel 1 (
  echo [ERRO] Falha ao registrar. Rode este .bat como Administrador.
  pause
  exit /b 1
)

echo.
echo OK. O agente iniciara automaticamente com o Windows.
echo Para iniciar agora sem reiniciar:  schtasks /Run /TN "%TASK%"
echo Para remover:                       schtasks /Delete /TN "%TASK%" /F
pause
