@echo off
rem Execution avec fenetre de navigateur visible (mise au point)
cd /d "%~dp0"
node src\inpi-factures.js --login
pause
