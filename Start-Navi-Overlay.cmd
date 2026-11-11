@echo off
if exist "%~dp0Navi.exe" (
  start "" "%~dp0Navi.exe" --overlay
  exit /b 0
)
echo The Navi program is not here. Download the full archive from the Releases page of the project,
echo or build it: powershell -ExecutionPolicy Bypass -File tools\build.ps1
pause
exit /b 1
