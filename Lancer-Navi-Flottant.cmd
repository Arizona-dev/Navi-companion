@echo off
if not exist "%~dp0overlay-app\NaviOverlay.exe" (
  echo La mini-carte n'est pas installee : dossier overlay-app absent.
  echo Telechargez l'archive complete depuis la page Releases du projet,
  echo ou compilez-la : dotnet publish overlay-src/NaviOverlay.csproj -c Release -o overlay-app
  pause
  exit /b 1
)
start "" "%~dp0overlay-app\NaviOverlay.exe"
