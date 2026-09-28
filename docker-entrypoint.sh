#!/bin/bash
set -e

PODLET_DATA="${HOME}/.podlet"

echo "Starting Podlet Gateway..."

if [ -z "${HOME}" ]; then
  echo "ERROR: HOME is not set in the container."
  echo "compose.yml should pass 'HOME: \${HOME}' in the gateway environment."
  exit 1
fi

# Verify the data directory is writable by the container user.
if [ ! -d "${PODLET_DATA}" ]; then
  echo "ERROR: Data directory ${PODLET_DATA} does not exist."
  echo "The volume mount may not be configured correctly."
  echo "Hint: on the host, ensure ${PODLET_DATA} exists and is owned by your user:"
  echo "  sudo chown -R \$(id -u):\$(id -g) \${HOME}/.podlet"
  exit 1
fi

if [ ! -w "${PODLET_DATA}" ]; then
  echo "ERROR: ${PODLET_DATA} is not writable by UID $(id -u)."
  echo "This usually has one of two causes — fix on the host, then restart:"
  echo "  a) The directory is root-owned from a previous root-mode install:"
  echo "       sudo chown -R \$(id -u):\$(id -g) \${HOME}/.podlet"
  echo "  b) Docker auto-created the directory as root because it was missing on"
  echo "     the host. Remove it and recreate it as your host user:"
  echo "       sudo rm -rf \${HOME}/.podlet && mkdir -p ~/.podlet"
  echo "     then run 'docker compose up' again."
  exit 1
fi

if [ ! -f "${PODLET_DATA}/config.json" ]; then
  echo ""
  echo "============================================"
  echo " Podlet - First Run Detected"
  echo "============================================"
  echo ""
  echo "No config.json found in ${PODLET_DATA}"
  echo ""
  echo "Initializing folder Podlet Folder"
  cp -r ".podlet/." "${PODLET_DATA}/"
  mv "${PODLET_DATA}/.env.example" "${PODLET_DATA}/.env"
  echo ""
  echo "Starting with default settings..."
  echo "============================================"
  echo ""
fi

# Verify the database is accessible
if [ -f "${PODLET_DATA}/podlet.db" ]; then
  DB_SIZE=$(stat -c%s "${PODLET_DATA}/podlet.db" 2>/dev/null || stat -f%z "${PODLET_DATA}/podlet.db" 2>/dev/null || echo "unknown")
  echo "Database found: ${PODLET_DATA}/podlet.db (${DB_SIZE} bytes)"
fi

exec "$@"
