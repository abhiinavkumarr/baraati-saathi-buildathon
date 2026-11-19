#!/bin/sh
# Container entrypoint. If ALLOYDB_INSTANCE_URI is set, run the AlloyDB Auth
# Proxy on 127.0.0.1:5432 (authenticated by the Cloud Run service account) and
# point the app at it. Otherwise DATABASE_URL (or the PGlite fallback) is used.
set -e
if [ -n "$ALLOYDB_INSTANCE_URI" ]; then
  # ALLOYDB_PROXY_FLAGS: e.g. "--public-ip" or "--psc"
  alloydb-auth-proxy $ALLOYDB_PROXY_FLAGS --address 127.0.0.1 --port 5432 "$ALLOYDB_INSTANCE_URI" &
  sleep 2
  export DATABASE_URL="postgres://${DB_USER:-postgres}:${DB_PASSWORD}@127.0.0.1:5432/${DB_NAME:-postgres}"
fi
exec node --import tsx server/index.ts
