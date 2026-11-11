# Builds dist/Navi-companion.zip: the app with its own Python (Navi.exe) and a self-contained mini-map.
# Requirements on the build machine only: Python 3 with PyInstaller, .NET SDK 8 or newer, git.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$stage = Join-Path $PSScriptRoot 'build\stage\Navi-companion'
Remove-Item -Recurse -Force 'build' -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $stage | Out-Null

# 1. Tracked project files, exactly as committed.
git archive --format=zip -o build\source.zip HEAD
if ($LASTEXITCODE -ne 0) { throw 'git archive failed' }
Expand-Archive -Path build\source.zip -DestinationPath $stage

# 2. Server with an embedded Python runtime (folder build: fewer antivirus false alarms than one big exe).
py -3 -m PyInstaller --noconfirm --clean --onedir --console --name Navi `
  --distpath build\dist --workpath build\work --specpath build server.py
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller failed' }
Copy-Item -Recurse -Force 'build\dist\Navi\*' $stage

# 3. Mini-map with the .NET runtime inside a single exe.
dotnet publish overlay-src\NaviOverlay.csproj -c Release -r win-x64 --self-contained true `
  -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true `
  -o (Join-Path $stage 'overlay-app')
if ($LASTEXITCODE -ne 0) { throw 'dotnet publish failed' }
Get-ChildItem (Join-Path $stage 'overlay-app') -Include *.xml, *.pdb -Recurse | Remove-Item -Force

# 4. Archive.
New-Item -ItemType Directory -Force 'dist' | Out-Null
Remove-Item -Force 'dist\Navi-companion.zip' -ErrorAction SilentlyContinue
Compress-Archive -Path $stage -DestinationPath 'dist\Navi-companion.zip'
Write-Host ('Built dist\Navi-companion.zip, version ' + (Get-Content VERSION))
