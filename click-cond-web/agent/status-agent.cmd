@echo off
REM Mostra se o Agente Local esta rodando, qual processo e a versao no log.
setlocal
echo === Processos do agente ===
tasklist /FI "IMAGENNAME eq click-agent.exe" | findstr /I click-agent.exe
if errorlevel 1 (
  tasklist /FI "IMAGENNAME eq node.exe" /V | findstr /I index.js
  if errorlevel 1 echo   ^(nenhum agente rodando^)
)
echo.
echo === Tarefa agendada ===
schtasks /Query /TN "ClickPortariaAgent" 2>nul | findstr /I "ClickPortariaAgent Status"
if errorlevel 1 echo   ^(tarefa nao registrada^)
echo.
echo === Ultima versao no log (agent-service.log) ===
if exist "%~dp0agent-service.log" (
  powershell -NoProfile -Command "Select-String -Path '%~dp0agent-service.log' -Pattern 'iniciando . versao' | Select-Object -Last 1 | ForEach-Object { $_.Line }"
) else (
  echo   ^(sem log ainda^)
)
echo.
pause
