@echo off
rem ============================================================
rem Installation de factures-inpi
rem  - installe les dependances Node + le navigateur Chromium
rem  - cree le fichier .env s'il n'existe pas
rem Prerequis : Node.js (https://nodejs.org)
rem ============================================================
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERREUR] Node.js n'est pas installe ou pas dans le PATH.
  echo Telechargez-le sur https://nodejs.org puis relancez ce script.
  pause
  exit /b 1
)

echo Installation des dependances...
call npm install --no-audit --no-fund
if errorlevel 1 ( pause & exit /b 1 )

echo Telechargement du navigateur Chromium...
call npx playwright install chromium
if errorlevel 1 ( pause & exit /b 1 )

if not exist .env (
  copy .env.example .env >nul
  echo.
  echo Le fichier .env a ete cree : ouvrez-le avec le Bloc-notes et
  echo renseignez INPI_USERNAME et INPI_PASSWORD.
)

echo.
echo Installation terminee.
echo Lancez interface.cmd : tout se configure ensuite dans le navigateur
echo (identifiants INPI, lancement, planification automatique).
pause
