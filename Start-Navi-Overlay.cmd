@echo off
if exist "%~dp0Navi.exe" (
  start "" "%~dp0Navi.exe" --overlay
  exit /b 0
)
if exist "%~dp0overlay-app\Navi.exe" (
  start "" "%~dp0overlay-app\Navi.exe" --overlay
  exit /b 0
)
echo The Navi program is not here. Download the full archive from the Releases page of the project,
echo or build it: dotnet build app-src/Navi.csproj -c Release -o overlay-app
pause
exit /b 1
