#!/bin/sh
set -eu
# A new Zeabur volume can be root-owned. Prepare only the heart's own volume,
# then drop privileges. The original OB volume is never mounted here.
if [ "$(id -u)" = 0 ]; then
  mkdir -p /app/state
  chown -R node:node /app/state
  chmod 700 /app/state
  exec su-exec node:node "$@"
fi
exec "$@"
