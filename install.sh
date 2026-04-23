#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/HellKaiser45/Podlet.git"
INSTALL_DIR="${1:-$HOME/podlet}"

echo ""
echo "  ╔════════════════════════════════════════╗"
echo "  ║       Podlet Installer                 ║"
echo "  ╚════════════════════════════════════════╝"
echo ""

# ── Prerequisites ──────────────────────────────────────
missing=0

if ! command -v git &>/dev/null; then
  echo "  [!] git not found. Install: https://git-scm.com"
  missing=1
fi

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

# ── Run init ───────────────────────────────────────────
echo ""
echo "  Launching setup wizard..."
echo ""
bun run init
