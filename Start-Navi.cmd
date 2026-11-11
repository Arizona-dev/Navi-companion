@echo off
cd /d "%~dp0"
set "PY="
py -3 --version >nul 2>nul && set "PY=py -3"
if not defined PY python --version >nul 2>nul && set "PY=python"
if not defined PY (
  echo Python 3 was not found.
  echo Install it from https://www.python.org/downloads/ and run this file again.
  pause
  exit /b 1
)
%PY% src\download_images.py
%PY% src\server.py --open
pause
