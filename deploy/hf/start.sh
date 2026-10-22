#!/usr/bin/env bash
# Starts the whole demo stack inside one container (see Dockerfile), in
# dependency order: Postgres -> schema -> Temporal -> API + worker -> nginx.
# If any long-running process exits, the container exits so the host restarts it.
set -euo pipefail

PGBIN=/usr/lib/postgresql/16/bin
export PGDATA=/tmp/pgdata

# Secrets: use the Space's secrets when set, otherwise generate per boot.
# Nothing outlives a restart, so per-boot secrets lose nothing.
gen() { openssl rand -base64 32 | tr -d '\n'; }
export SECRET_KEY="${SECRET_KEY:-$(gen)}"
export INTERNAL_TOKEN="${INTERNAL_TOKEN:-$(gen)}"
export LOCAL_RUNNER_TOKEN="${LOCAL_RUNNER_TOKEN:-$(gen)}"

# Postgres listens on loopback only, so trust auth never leaves the container.
if [ ! -s "$PGDATA/PG_VERSION" ]; then
  "$PGBIN/initdb" -D "$PGDATA" -U awb -A trust >/dev/null
fi
"$PGBIN/pg_ctl" -D "$PGDATA" -l /tmp/postgres.log -w \
  -o "-c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp" start
"$PGBIN/createdb" -h 127.0.0.1 -U awb awb 2>/dev/null || true

npm run db:push -w @awb/api

temporal server start-dev --ip 127.0.0.1 --headless --db-filename /tmp/temporal.db \
  --log-level warn &
until temporal operator cluster health --address 127.0.0.1:7233 >/dev/null 2>&1; do
  sleep 1
done

node apps/api/dist/index.js &
node apps/worker/dist/index.js &
nginx -c /app/deploy/hf/nginx.conf -g "daemon off;" &

wait -n
echo "[start] a process exited; stopping the container" >&2
exit 1
