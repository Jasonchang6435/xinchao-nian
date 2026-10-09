#!/bin/sh
set -eu
# Fail before the upstream entrypoint's directory-recovery logic can touch an
# accidental directory mount at the config file path. Preserve existing data.
config="${OMBRE_CONFIG_PATH:-/app/buckets/config.yaml}"
if [ -d "$config" ] || [ -L "$config" ]; then
    echo '[zeabur] OMBRE_CONFIG_PATH must be a regular file; mount /app/buckets, not config.yaml' >&2
    exit 1
fi
if [ "${OMBRE_MCP_REQUIRE_AUTH:-true}" != true ]; then
    echo '[zeabur] OMBRE_MCP_REQUIRE_AUTH must be true' >&2
    exit 1
fi
OMBRE_MCP_SERVICE_TOKEN="${OMBRE_MCP_SERVICE_TOKEN:-}"
OMBRE_DASHBOARD_PASSWORD="${OMBRE_DASHBOARD_PASSWORD:-}"
if [ "${#OMBRE_MCP_SERVICE_TOKEN}" -lt 32 ] || [ "${#OMBRE_DASHBOARD_PASSWORD}" -lt 16 ]; then
    echo '[zeabur] set a memory service token (>=32) and an independent OB dashboard password (>=16)' >&2
    exit 1
fi
case "$OMBRE_MCP_SERVICE_TOKEN:$OMBRE_DASHBOARD_PASSWORD" in
    *REPLACE_*|*replace-with*)
        echo '[zeabur] replace example credentials before starting' >&2
        exit 1
        ;;
esac
if [ "$OMBRE_MCP_SERVICE_TOKEN" = "$OMBRE_DASHBOARD_PASSWORD" ]; then
    echo '[zeabur] use independent memory service and OB dashboard credentials' >&2
    exit 1
fi
umask 077
exec /app/entrypoint.sh
