#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/HellKaiser45/Podlet.git"
INSTALL_DIR="${1:-$HOME/podlet}"

echo ""
echo "  ╔════════════════════════════════════════╗"
echo "  ║       Podlet Installer                 ║"
echo "  ╚════════════════════════════════════════╝"
echo ""

# ── Clone ──────────────────────────────────────────────
if [ -d "$INSTALL_DIR" ]; then
  echo "  Directory $INSTALL_DIR already exists. Pulling latest..."
  cd "$INSTALL_DIR"
  git pull || true
else
  echo "  Cloning Podlet into $INSTALL_DIR..."
  git clone "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# ── Installation Choice ────────────────────────────────
echo ""
echo "  How would you like to run Podlet?"
echo "    1) Docker (recommended) -- easiest setup, isolated environment"
echo "    2) Native -- requires Bun and Python 3.12+"
echo ""
read -p "  Enter your choice [1/2]: " choice

if [ "$choice" == "1" ]; then
  # ── Docker Path ──────────────────────────────────────
  echo ""
  echo "  Checking Docker prerequisites..."
  
  if ! command -v docker &>/dev/null; then
    echo "  [!] docker not found. Please install Docker: https://docs.docker.com/get-docker/"
    exit 1
  fi

  if ! docker compose version &>/dev/null; then
    echo "  [!] docker compose not found. Please ensure Docker Compose is installed."
    exit 1
  fi

  echo "  Preparing Docker environment..."

  # Create .env file with the user's Podlet data directory
  PODLET_DIR="${HOME}/.podlet"
  echo "PODLET_DIR=${PODLET_DIR}" > .env
  echo "  Created .env with PODLET_DIR=${PODLET_DIR}"

  # Ensure the data directory exists
  mkdir -p "${PODLET_DIR}"

  echo ""
  echo "  Launching setup wizard via Docker..."
  echo ""
  docker compose run --rm gateway bun run init --docker

  echo ""
  echo "  Setup complete! To start Podlet:"
  echo "    docker compose up -d"
  echo ""
  echo "  Then visit: http://localhost:3002 (or the port you chose)"
  echo ""
  echo "  To stop: docker compose down"
  echo "  To view logs: docker compose logs -f gateway"

else
  # ── Native Path ──────────────────────────────────────
  echo ""
  echo "  Checking Native prerequisites..."
  missing=0

  if ! command -v bun &>/dev/null; then
    echo "  [!] bun not found. Install: https://bun.sh"
    missing=1
  fi

  if ! command -v python3 &>/dev/null; then
    echo "  [!] python3 not found. Install: https://www.python.org"
    missing=1
  fi

  if [ "$missing" -eq 1 ]; then
    echo ""
    echo "  Please install the missing dependencies and re-run this script."
    exit 1
  fi

  echo ""
  echo "  Launching setup wizard..."
  echo ""
  bun run init
fi
