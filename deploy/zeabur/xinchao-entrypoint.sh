#!/bin/sh
set -eu
case "${SERVICE_TOKEN:-}:${DASHBOARD_ACCESS_TOKEN:-}:${OAUTH_APPROVAL_TOKEN:-}:${OMBRE_MCP_TOKEN:-}" in
    *REPLACE_*|*replace-with*)
        echo '[zeabur] replace example credentials before starting' >&2
        exit 1
        ;;
esac
# PaaS volumes may start root-owned; only repair the mount root, never recurse
# through private state or rewrite existing files. The server runs as uid 1000.
if [ "$(id -u)" = 0 ]; then
    if [ -L /app/state ]; then
        echo '[zeabur] /app/state must be a real volume directory' >&2
        exit 1
    fi
    mkdir -p /app/state
    chown node:node /app/state
    chmod 700 /app/state
    exec su-exec node:node "$0" "$@"
fi
if [ ! -d /app/state ] || [ ! -w /app/state ]; then
    echo '[zeabur] mount a writable volume at /app/state (owner uid 1000)' >&2
    exit 1
fi
umask 077
exec "$@"
