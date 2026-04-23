$ErrorActionPreference = "Stop"

$RepoUrl = "https://github.com/HellKaiser45/Podlet.git"
$InstallDir = if ($args[0]) { $args[0] } else { Join-Path $env:USERPROFILE "podlet" }

Write-Host ""
Write-Host "  ╔════════════════════════════════════════╗"
Write-Host "  ║       Podlet Installer                 ║"
Write-Host "  ╚════════════════════════════════════════╝"
Write-Host ""

# ── Prerequisites ──────────────────────────────────────
$missing = $false

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host "  [!] git not found. Install: https://git-scm.com" -ForegroundColor Red
  $missing = $true
}

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  Write-Host "  [!] bun not found. Install: https://bun.sh" -ForegroundColor Red
  $missing = $true
}

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
  Write-Host "  [!] python not found. Install: https://www.python.org" -ForegroundColor Red
  $missing = $true
}

if ($missing) {
  Write-Host ""
  Write-Host "  Please install the missing dependencies and re-run this script."
  exit 1
}

# ── Clone ──────────────────────────────────────────────
if (Test-Path $InstallDir) {
  Write-Host "  Directory $InstallDir already exists. Pulling latest..."
  Set-Location $InstallDir
  git pull
} else {
  Write-Host "  Cloning Podlet into $InstallDir..."
  git clone $RepoUrl $InstallDir
  Set-Location $InstallDir
}

# ── Run init ───────────────────────────────────────────
Write-Host ""
Write-Host "  Launching setup wizard..."
Write-Host ""
bun run init
