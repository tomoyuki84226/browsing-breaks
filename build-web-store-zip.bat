@echo off
setlocal

set "BB_PACKAGE_ROOT=%~dp0"

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop';" ^
  "$root = [IO.Path]::GetFullPath($env:BB_PACKAGE_ROOT);" ^
  "$stage = $null;" ^
  "try {" ^
  "  $manifestPath = Join-Path $root 'manifest.json';" ^
  "  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json;" ^
  "  if ([string]::IsNullOrWhiteSpace([string]$manifest.version)) { throw 'manifest.json does not contain a version.'; }" ^
  "  $dist = Join-Path $root 'dist';" ^
  "  $zip = Join-Path $dist ('browsing-breaks-' + $manifest.version + '.zip');" ^
  "  $stage = Join-Path ([IO.Path]::GetTempPath()) ('browsing-breaks-package-' + [guid]::NewGuid().ToString('N'));" ^
  "  New-Item -ItemType Directory -Path $stage | Out-Null;" ^
  "  New-Item -ItemType Directory -Path (Join-Path $stage 'icons') | Out-Null;" ^
  "  Copy-Item -LiteralPath $manifestPath -Destination $stage;" ^
  "  Copy-Item -LiteralPath (Join-Path $root '_locales') -Destination $stage -Recurse;" ^
  "  Copy-Item -LiteralPath (Join-Path $root 'src') -Destination $stage -Recurse;" ^
  "  @('icon-16.png', 'icon-32.png', 'icon-48.png', 'icon-128.png') | ForEach-Object {" ^
  "    Copy-Item -LiteralPath (Join-Path $root ('icons\' + $_)) -Destination (Join-Path $stage 'icons');" ^
  "  };" ^
  "  New-Item -ItemType Directory -Path $dist -Force | Out-Null;" ^
  "  Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal -Force;" ^
  "  Write-Host ('Created: ' + $zip);" ^
  "} finally {" ^
  "  if ($stage -and (Test-Path -LiteralPath $stage)) { Remove-Item -LiteralPath $stage -Recurse -Force; }" ^
  "}"

if errorlevel 1 (
  echo Failed to create the Chrome Web Store package.
  exit /b 1
)

exit /b 0
