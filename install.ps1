#Requires -Version 5.1
<#
    Podlet Installer (PowerShell)
    Equivalent of install.sh
    Usage: .\install-podlet.ps1 [InstallDir]
#>

param(
    [Parameter(Position = 0)]
    [string]$InstallDir = (Join-Path $HOME "podlet")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepoUrl = "https://github.com/HellKaiser45/Podlet.git"

function Test-CommandExists {
    param([string]$Name)
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

Write-Host ""
Write-Host "  ╔════════════════════════════════════════╗"
Write-Host "  ║       Podlet Installer                 ║"
Write-Host "  ╚════════════════════════════════════════╝"
Write-Host ""

# ── Clone ──────────────────────────────────────────────
if (Test-Path -Path $InstallDir -PathType Container) {
    Write-Host "  Directory $InstallDir already exists. Pulling latest..."
    Set-Location -Path $InstallDir
    try {
        git pull
    } catch {
        # equivalent of `git pull || true`
    }
} else {
    Write-Host "  Cloning Podlet into $InstallDir..."
    git clone $RepoUrl $InstallDir
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Set-Location -Path $InstallDir
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

    if (-not (Test-CommandExists "docker")) {
        Write-Host "  [!] docker not found. Please install Docker: https://docs.docker.com/get-docker/"
        exit 1
    }

    docker compose version *> $null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [!] docker compose not found. Please ensure Docker Compose is installed."
        exit 1
    }

    Write-Host "  Preparing Docker environment..."
    # Ensure the data directory exists
    New-Item -ItemType Directory -Force -Path (Join-Path $HOME ".podlet") | Out-Null
    Write-Host "  Data directory: ~/.podlet"
    Write-Host ""
    Write-Host "  Launching setup wizard via Docker..."
    Write-Host ""
    docker compose run --rm gateway bun run init --docker
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
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

    if (-not (Test-CommandExists "bun")) {
        Write-Host "  [!] bun not found. Install: https://bun.sh"
        $missing = $true
    }
    if (-not (Test-CommandExists "python3") -and -not (Test-CommandExists "python")) {
        Write-Host "  [!] python3 not found. Install: https://www.python.org"
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
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
