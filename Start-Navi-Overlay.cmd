@echo off
if not exist "%~dp0overlay-app\NaviOverlay.exe" (
  echo The mini-map is not installed: the overlay-app folder is missing.
  echo Download the full archive from the Releases page of the project,
  echo or build it: dotnet publish overlay-src/NaviOverlay.csproj -c Release -o overlay-app
  pause
  exit /b 1
)
start "" "%~dp0overlay-app\NaviOverlay.exe"
