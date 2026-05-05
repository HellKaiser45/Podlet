#!/bin/bash
set -e

# Podlet Gateway Docker Entrypoint

PODLET_DIR="${PODLET_DIR:-/podlet-data}"

if [ ! -f "${PODLET_DIR}/config.json" ]; then
  echo "============================================"
  echo " Podlet - No Configuration Found"
  echo "============================================"
  echo ""
  echo "No config.json at ${PODLET_DIR}/config.json"
  echo ""
  echo "To configure Podlet, run:"
  echo "  docker compose run --rm -it gateway bun run init"
  echo ""
  echo "Starting with default settings..."
  echo "============================================"
fi

echo "Starting Podlet Gateway..."
exec bun run apps/gateway/src/start_prod_server.ts
