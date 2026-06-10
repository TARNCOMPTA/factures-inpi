@echo off
rem Execution silencieuse (utilisee par la tache planifiee)
cd /d "%~dp0"
node src\inpi-factures.js
