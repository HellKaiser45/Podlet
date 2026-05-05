#!/bin/bash
set -e

# Podlet Gateway Docker Entrypoint

PODLET_DATA="/root/.podlet"

echo "Starting Podlet Gateway..."
echo "Data directory: ${PODLET_DATA}"

# Verify the data directory mount
if [ ! -d "${PODLET_DATA}" ]; then
  echo "ERROR: Data directory ${PODLET_DATA} does not exist."
  echo "The volume mount may not be configured correctly."
  echo "Make sure PODLET_DIR in your .env file points to an existing directory."
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
  echo "To set up Podlet, run:"
  echo "  docker compose run --rm -it gateway bun run init"
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

exec bun run apps/gateway/src/start_prod_server.ts
