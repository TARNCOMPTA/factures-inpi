@echo off
rem ============================================================
rem Cree la tache planifiee Windows "Factures INPI"
rem (chaque lundi a 9h00 — modifiable ci-dessous ou ensuite dans
rem  le Planificateur de taches)
rem ============================================================
cd /d "%~dp0"
schtasks /create /tn "Factures INPI" /tr "\"%~dp0run.cmd\"" /sc weekly /d MON /st 09:00 /f
if errorlevel 1 (
  echo [ERREUR] Impossible de creer la tache planifiee.
) else (
  echo Tache "Factures INPI" creee : chaque lundi a 9h00.
)
pause
