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
    # Zeabur exec runs as root even though the server runs as uid 1000.
    # Recover known private state files restored by that root session. Leave
    # other owners and all unrelated files untouched; never follow symlinks.
    for name in state.json oauth.json black-box.json cabin.json transitions.jsonl personality.json bridge-queue.json; do
        state_file="/app/state/$name"
        if [ -L "$state_file" ]; then
            echo "[zeabur] refusing symlink in known state file: $name" >&2
            exit 1
        fi
        if [ -f "$state_file" ] && [ "$(stat -c %u "$state_file")" = 0 ]; then
            if [ "$(stat -c %h "$state_file")" != 1 ]; then
                echo "[zeabur] refusing hard-linked state file: $name" >&2
                exit 1
            fi
            chown node:node "$state_file"
            chmod 600 "$state_file"
        fi
    done
    exec su-exec node:node "$0" "$@"
fi
if [ ! -d /app/state ] || [ ! -w /app/state ]; then
    echo '[zeabur] mount a writable volume at /app/state (owner uid 1000)' >&2
    exit 1
fi
umask 077
exec "$@"
