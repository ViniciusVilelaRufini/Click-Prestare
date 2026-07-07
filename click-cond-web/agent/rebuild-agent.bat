@echo off
:: ===================================================================
::  Click Portaria - Recompilar e Reiniciar o Agente Local
::  RODE ESTE ARQUIVO COMO ADMINISTRADOR!
:: ===================================================================
setlocal
cd /d "%~dp0"

echo.
echo === 1/3 Parando agente e tarefa agendada antiga ===
schtasks /End /TN "ClickPortariaAgent" >nul 2>&1
taskkill /F /IM click-agent.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo === 2/3 Recompilando o executavel (click-agent.exe) ===
call node build-exe.mjs
if errorlevel 1 (
  echo.
  echo [ERRO] Falha ao compilar o executavel.
  pause
  exit /b 1
)

echo === 3/3 Iniciando a tarefa agendada do agente ===
schtasks /Run /TN "ClickPortariaAgent" >nul 2>&1

echo.
echo === Concluido com sucesso! ===
echo O agente foi atualizado com a funcionalidade de flash automatico.
echo.
pause
