#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

LOG_DIR=/tmp/opencode
mkdir -p "$LOG_DIR"

export NODE_ENV=test
export DATABASE_URL=postgresql://herald:herald@localhost:5434/herald_test
export REDIS_URL=redis://localhost:6380
export KAFKA_BROKERS=localhost:9093
export SMTP_URL=smtp://localhost:1026
export MAILPIT_URL=http://localhost:8026
export PORT=3100
export HERALD_DEMO_DIR=/tmp/opencode/herald-test
export HERALD_API_URL=http://localhost:3100

cleanup() {
  kill "${API_PID:-}" "${WORKER_PID:-}" >/dev/null 2>&1 || true
  docker compose -f compose.test.yml down -v >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker compose -f compose.test.yml up -d
for _ in $(seq 1 60); do
  if docker exec herald-test-postgres-1 pg_isready -U herald -d herald_test >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
./scripts/wait-for.sh http://localhost:8026/readyz 60

pnpm --filter @herald/db exec prisma migrate deploy >/dev/null
pnpm --filter @herald/db prisma:seed >/dev/null

node apps/api/dist/index.js > "$LOG_DIR/herald-test-api.log" 2>&1 &
API_PID=$!
node apps/worker/dist/index.js > "$LOG_DIR/herald-test-worker.log" 2>&1 &
WORKER_PID=$!

./scripts/wait-for.sh http://localhost:3100/health/ready 120
pnpm tsx scripts/smoke.ts
