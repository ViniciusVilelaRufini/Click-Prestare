@echo off
REM Mostra se o Agente Local esta rodando, qual processo e a versao no log.
setlocal
echo === Processos do agente ===
tasklist /FI "IMAGENAME eq click-agent.exe" | findstr /I click-agent.exe
if errorlevel 1 (
  REM O tasklist nao mostra a linha de comando: quem acha o node do agente e o
  REM Win32_Process (mesma consulta do install-windows.bat). So LISTA, nao encerra nada.
  powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*click-agent.cjs*' } | ForEach-Object { 'node.exe  PID ' + $_.ProcessId + '  ' + $_.CommandLine }" | findstr /I click-agent.cjs
  if errorlevel 1 echo   ^(nenhum agente rodando^)
)
echo.
echo === Tarefa agendada ===
schtasks /Query /TN "ClickPortariaAgent" 2>nul | findstr /I "ClickPortariaAgent Status"
if errorlevel 1 echo   ^(tarefa nao registrada^)
echo.
echo === Ultima versao no log (agent-service.log) ===
if exist "%~dp0agent-service.log" (
  powershell -NoProfile -Command "Select-String -Path '%~dp0agent-service.log' -Pattern 'iniciando .{1,3} vers.{1,2}o ' | Select-Object -Last 1 | ForEach-Object { $_.Line }"
) else (
  echo   ^(sem log ainda^)
)
echo.
pause
