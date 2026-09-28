#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: Docker is not installed or not on PATH." >&2
  exit 1
fi

if [ -z "${HOME:-}" ]; then
  echo "ERROR: HOME is not set. Run this from a normal user shell." >&2
  exit 1
fi

if ! command -v id >/dev/null 2>&1; then
  echo "ERROR: This helper requires a Unix-like shell with id(1)." >&2
  echo "Set PODLET_UID and PODLET_GID yourself and run docker compose directly." >&2
  exit 1
fi

export PODLET_UID="${PODLET_UID:-$(id -u)}"
export PODLET_GID="${PODLET_GID:-$(id -g)}"

mkdir -p "${HOME}/.podlet"

exec docker compose "$@"
