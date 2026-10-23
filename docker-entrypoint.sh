#!/bin/sh
set -e

# The workspace is a bind mount owned by the host user, so git refuses to touch it
# ("dubious ownership") unless we say it is fine. Everything here is confined to the container.
git config --global --add safe.directory '*' || true

# The commit button fails outright without an identity, so give it one.
git config --global user.name "${MEW_GIT_NAME:-mew}" || true
git config --global user.email "${MEW_GIT_EMAIL:-mew@localhost}" || true

if [ ! -w "${MEW_DATA_DIR:-/data}" ]; then
  echo "[mew] ${MEW_DATA_DIR:-/data} is not writable by uid $(id -u)." >&2
  echo "[mew] Fix on the host: chown -R \$(id -u):\$(id -g) ./data" >&2
  exit 1
fi

exec "$@"
