# Builds dist/Navi-companion.zip: the Navi application window (Navi.exe), its server with an
# embedded Python (server\navi-server.exe) and the web interface.
# Requirements on the build machine only: Python 3 with PyInstaller, .NET SDK 8 or newer, git.
param([string]$Work = 'build')
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$stage = Join-Path $PSScriptRoot "$Work\stage\Navi-companion"
Remove-Item -Recurse -Force $Work -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $stage | Out-Null

# 1. Tracked project files, exactly as committed.
git archive --format=zip -o "$Work\source.zip" HEAD
if ($LASTEXITCODE -ne 0) { throw 'git archive failed' }
Expand-Archive -Path "$Work\source.zip" -DestinationPath $stage

# 2. Server with an embedded Python runtime (folder build: fewer antivirus false alarms than one big exe).
py -3 -m PyInstaller --noconfirm --clean --onedir --console --name navi-server `
  --distpath "$Work\dist" --workpath "$Work\work" --specpath $Work server.py
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller failed' }
Copy-Item -Recurse -Force "$Work\dist\navi-server" (Join-Path $stage 'server')

# 3. Application window and mini-map: a small .NET Framework program (already part of Windows).
dotnet build app-src\Navi.csproj -c Release -o "$Work\shell" --nologo -v quiet
if ($LASTEXITCODE -ne 0) { throw 'dotnet build failed' }
Get-ChildItem "$Work\shell" -File | Where-Object { $_.Name -notmatch 'Wpf|\.xml$|\.pdb$' } | Copy-Item -Destination $stage -Force

# 4. Archive.
New-Item -ItemType Directory -Force 'dist' | Out-Null
Remove-Item -Force 'dist\Navi-companion.zip' -ErrorAction SilentlyContinue
Compress-Archive -Path $stage -DestinationPath 'dist\Navi-companion.zip'
Write-Host ('Built dist\Navi-companion.zip, version ' + (Get-Content VERSION))
