@echo off
cd /d "%~dp0"
"%~dp0click-agent.exe" >> "%~dp0agent-service.log" 2>&1
