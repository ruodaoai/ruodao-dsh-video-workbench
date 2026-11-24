<#
  DSH Video Workbench - Optional Local Lip-Sync (Talking-Head) Engine Installer (Windows PowerShell)

  Installs MuseTalk 1.5 (official GitHub + official Hugging Face weights) into a folder of your choice,
  reuses an existing CUDA PyTorch when available, keeps every cache next to the install folder,
  and wires AVATAR_LIPSYNC_* into .env.

  Examples:
    powershell -ExecutionPolicy Bypass -File scripts\install-lipsync-engine.ps1 -InstallDir D:\dsh-ai\lipsync
    powershell -ExecutionPolicy Bypass -File scripts\install-lipsync-engine.ps1 -InstallDir E:\dsh-ai\lipsync -Mirror global
    powershell -ExecutionPolicy Bypass -File scripts\install-lipsync-engine.ps1 -Status
#>
param(
  [ValidateSet('musetalk')]
  [string]$Engine = 'musetalk',
  [string]$InstallDir = '',
  [ValidateSet('cn','global')]
  [string]$Mirror = 'cn',
  [string]$Python = '',
  [switch]$Status,
  [switch]$NoEnv
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$MjsInstaller = Join-Path $ScriptRoot 'install-lipsync-engine.mjs'
if (-not (Test-Path $MjsInstaller)) {
  Write-Host "install-lipsync-engine.mjs not found next to this script." -ForegroundColor Red
  exit 1
}

if ($Status) {
  & node $MjsInstaller --status --deep
  exit $LASTEXITCODE
}

if (-not $InstallDir) {
  Write-Host "Lip-sync engine install folder (needs ~5 GB free, e.g. D:\dsh-ai\lipsync):" -ForegroundColor White
  $InstallDir = Read-Host "Install folder"
  if (-not $InstallDir) { Write-Host "Cancelled."; exit 0 }
}

$nodeArgs = @($MjsInstaller, '--engine', $Engine, '--dir', $InstallDir, '--mirror', $Mirror)
if ($Python) { $nodeArgs += @('--python', $Python) }
if ($NoEnv) { $nodeArgs += @('--no-env') }
& node @nodeArgs
exit $LASTEXITCODE
