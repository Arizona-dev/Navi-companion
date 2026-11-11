@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PY="
py -3 --version >nul 2>nul && set "PY=py -3"
if not defined PY python --version >nul 2>nul && set "PY=python"
if not defined PY (
  echo Python 3 est introuvable.
  echo Installez-le depuis https://www.python.org/downloads/ puis relancez ce fichier.
  pause
  exit /b 1
)
%PY% telecharger-images.py
%PY% server.py --open
pause
