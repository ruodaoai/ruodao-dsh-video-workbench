<#
  DSH Video Workbench - Optional Local TTS Model One-Click Installer (Windows PowerShell)
  Copyright (c) 2026 Merziller (QQ: 1411574209 | WeChat: Merziller | Email: k26789228@gmail.com)
  GitHub: https://github.com/Merziller/dsh-video-workbench

  Run directly in PowerShell to freely choose & install Edge-TTS / IndexTTS-2.5 / IndexTTS-2 / GPT-SoVITS
  and auto-connect it into dsh-video-workbench (including auto-creating voices/ + default speaker WAV).
#>
param(
  [ValidateSet('menu','edge-tts','indextts25','indextts2','gptvoice')]
  [string]$Engine = 'menu',
  [string]$InstallDir = '',
  [ValidateSet('cn','global')]
  [string]$Mirror = 'cn'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "  DSH Video Workbench - Optional TTS Engine Installer (by Merziller)" -ForegroundColor Yellow
Write-Host "  QQ: 1411574209 | WeChat: Merziller | Email: k26789228@gmail.com" -ForegroundColor Gray
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""

if ($Engine -eq 'menu') {
  Write-Host "Please select an optional TTS engine to install (all optional):" -ForegroundColor White
  Write-Host "  [1] Edge-TTS      (0GB VRAM, Pure CPU, ~15s, works on any PC)" -ForegroundColor Green
  Write-Host "  [2] IndexTTS-2.5  (Recommended 8GB+ NVIDIA VRAM, Flagship Emotional Voice Cloning)" -ForegroundColor Cyan
  Write-Host "  [3] GPT-SoVITS    (Recommended 4GB+ NVIDIA VRAM, Low-VRAM Fast Cloning)" -ForegroundColor Cyan
  Write-Host "  [4] IndexTTS-2    (Recommended 6-8GB NVIDIA VRAM, Classic Version)" -ForegroundColor Cyan
  Write-Host "  [0] Exit (Use built-in Windows Native Voice 0GB or Pure-Music Beat-Sync)" -ForegroundColor Gray
  Write-Host ""
  $choice = Read-Host "Enter choice (0-4)"
  switch ($choice) {
    '1' { $Engine = 'edge-tts' }
    '2' { $Engine = 'indextts25' }
    '3' { $Engine = 'gptvoice' }
    '4' { $Engine = 'indextts2' }
    default { Write-Host "Exited. You can still use Windows Native SAPI or Pure-Music Beat-Sync out of the box!"; exit 0 }
  }
}

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$MjsInstaller = Join-Path $ScriptRoot 'install-tts-engine.mjs'
if (-not (Test-Path $MjsInstaller)) {
  $MjsInstaller = Join-Path (Split-Path -Parent $ScriptRoot) 'scripts\install-tts-engine.mjs'
}

if (Test-Path $MjsInstaller) {
  $nodeArgs = @($MjsInstaller, '--engine', $Engine, '--mirror', $Mirror)
  if ($InstallDir) { $nodeArgs += @('--dir', $InstallDir) }
  & node @nodeArgs
  exit $LASTEXITCODE
} else {
  Write-Host "Standalone mode: please place this script inside your dsh-video-workbench folder or run inside the Web Studio -> Voice Center -> One-Click Install tab." -ForegroundColor Yellow
  exit 1
}
