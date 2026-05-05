$ErrorActionPreference = "Stop"

$RepoUrl = "https://github.com/HellKaiser45/Podlet.git"
$InstallDir = if ($args[0]) { $args[0] } else { Join-Path $env:USERPROFILE "podlet" }

Write-Host ""
Write-Host "  ╔════════════════════════════════════════╗"
Write-Host "  ║       Podlet Installer                 ║"
Write-Host "  ╚════════════════════════════════════════╝"
Write-Host ""

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

# ── Installation Choice ────────────────────────────────
Write-Host ""
Write-Host "  How would you like to run Podlet?"
Write-Host "    1) Docker (recommended) -- easiest setup, isolated environment"
Write-Host "    2) Native -- requires Bun and Python 3.12+"
Write-Host ""
$choice = Read-Host "  Enter your choice [1/2]"

if ($choice -eq "1") {
  # ── Docker Path ──────────────────────────────────────
  Write-Host ""
  Write-Host "  Checking Docker prerequisites..."

  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "  [!] docker not found. Please install Docker: https://docs.docker.com/get-docker/" -ForegroundColor Red
    exit 1
  }

  if (-not (Get-Command "docker compose" -ErrorAction SilentlyContinue)) {
    Write-Host "  [!] docker compose not found. Please ensure Docker Compose is installed." -ForegroundColor Red
    exit 1
  }

  Write-Host "  Preparing Docker environment..."
  Copy-Item ".env.docker.example" ".env.docker"

  Write-Host ""
  Write-Host "  Launching setup wizard via Docker..."
  Write-Host ""
  docker compose run --rm gateway bun run init --docker

  Write-Host ""
  Write-Host "  Setup complete! To start Podlet:"
  Write-Host "    docker compose up -d"
  Write-Host ""
  Write-Host "  Then visit: http://localhost:3002 (or the port you chose)"
  Write-Host ""
  Write-Host "  To stop: docker compose down"
  Write-Host "  To view logs: docker compose logs -f gateway"
} else {
  # ── Native Path ──────────────────────────────────────
  Write-Host ""
  Write-Host "  Checking Native prerequisites..."
  $missing = $false

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

  Write-Host ""
  Write-Host "  Launching setup wizard..."
  Write-Host ""
  bun run init
}
