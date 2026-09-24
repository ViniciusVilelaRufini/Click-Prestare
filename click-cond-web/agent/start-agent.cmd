@echo off
REM Inicia o Agente Local (Click Portaria) e registra log na mesma pasta.
REM Usado pelo launch-hidden.vbs (auto-start ao logon) ou diretamente.
REM Requer o bundle gerado (npm run build) — roda dist/click-agent.cjs, não o
REM fonte em src/.
cd /d "%~dp0"
node "%~dp0dist\click-agent.cjs" >> "%~dp0agent-service.log" 2>&1
