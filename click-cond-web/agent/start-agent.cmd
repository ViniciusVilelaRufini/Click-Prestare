@echo off
REM Inicia o Agente Local (Click Portaria) e registra log na mesma pasta.
REM Usado pelo launch-hidden.vbs (auto-start ao logon) ou diretamente.
cd /d "%~dp0"
node "%~dp0index.js" >> "%~dp0agent-service.log" 2>&1
