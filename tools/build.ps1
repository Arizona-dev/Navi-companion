# Builds dist/Navi-companion.zip: the Navi application window (Navi.exe), its server with an
# embedded Python (server\navi-server.exe), the web interface and the game reference data.
# Requirements on the build machine only: Python 3 with PyInstaller, .NET SDK 8 or newer, git.
param([string]$Work = 'build')
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

$stage = Join-Path $root "$Work\stage\Navi-companion"
Remove-Item -Recurse -Force $Work -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $stage | Out-Null

# 1. Committed files meant for users (.gitattributes lists what stays out of the archive).
git archive --format=zip -o "$Work\source.zip" HEAD
if ($LASTEXITCODE -ne 0) { throw 'git archive failed' }
Expand-Archive -Path "$Work\source.zip" -DestinationPath $stage

# 2. Server with an embedded Python runtime (folder build: fewer antivirus false alarms than one big exe).
py -3 -m PyInstaller --noconfirm --clean --onedir --console --name navi-server `
  --distpath "$Work\dist" --workpath "$Work\work" --specpath $Work src\server.py
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller failed' }
Copy-Item -Recurse -Force "$Work\dist\navi-server" (Join-Path $stage 'server')

# 3. Application window and mini-map: a small .NET Framework program (already part of Windows).
#    Its intermediate files go to the work folder, never next to the sources.
dotnet build app-src\Navi.csproj -c Release -o "$Work\shell" --nologo -v quiet
if ($LASTEXITCODE -ne 0) { throw 'dotnet build failed' }
Get-ChildItem "$Work\shell" -File | Where-Object { $_.Name -notmatch 'Wpf|\.xml$|\.pdb$' } | Copy-Item -Destination $stage -Force

# 4. Archive, refused if it contains anything private (personal paths, settings, game images).
New-Item -ItemType Directory -Force 'dist' | Out-Null
Remove-Item -Force 'dist\Navi-companion.zip' -ErrorAction SilentlyContinue
Compress-Archive -Path $stage -DestinationPath 'dist\Navi-companion.zip'
py -3 tools\check_leaks.py --zip 'dist\Navi-companion.zip'
if ($LASTEXITCODE -ne 0) {
  Remove-Item -Force 'dist\Navi-companion.zip'
  throw 'The archive contains private data: it was deleted.'
}
Write-Host ('Built dist\Navi-companion.zip, version ' + (Get-Content VERSION))
