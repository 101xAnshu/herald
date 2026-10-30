#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

PRIMARY=herald-postgres-1
STANDBY=herald-postgres-standby-1
COMPOSE=(docker compose -f compose.yml -f compose.dr.yml)
RESULT_DIR=drill-results
RESULT="$RESULT_DIR/latest.md"
mkdir -p "$RESULT_DIR"

if [[ ! -f .herald/demo.env ]]; then
  echo "missing .herald/demo.env; run make demo or pnpm seed first" >&2
  exit 1
fi

BOOKING_KEY=$(grep '^HERALD_BOOKING_API_KEY=' .herald/demo.env | cut -d= -f2)

echo "1/7 configure streaming replication"
docker exec -i "$PRIMARY" psql -U herald -d herald >/dev/null <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'replicator') THEN
    CREATE ROLE replicator REPLICATION LOGIN PASSWORD 'replicator';
  END IF;
END
$$;
SQL

docker exec "$PRIMARY" sh -c "grep -q 'host replication replicator' /var/lib/postgresql/data/pg_hba.conf || echo 'host replication replicator all trust' >> /var/lib/postgresql/data/pg_hba.conf"
docker exec "$PRIMARY" psql -U herald -d herald -c "select pg_reload_conf()" >/dev/null

echo "2/7 start the standby and wait for streaming"
"${COMPOSE[@]}" up -d postgres-standby >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$STANDBY" pg_isready -U herald -d herald >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

BEFORE=$(docker exec "$PRIMARY" psql -U herald -d herald -t -A -c "select count(*) from notifications")

for _ in $(seq 1 60); do
  LAG=$(docker exec "$PRIMARY" psql -U herald -d herald -t -A -c "select coalesce(max(extract(epoch from replay_lag)), 999) from pg_stat_replication where state='streaming'" | head -1)
  if [[ -n "$LAG" && "$LAG" != "999" ]]; then
    break
  fi
  sleep 2
done

DRILL_START=$(date +%s)

echo "3/7 stop application writers"
docker compose stop api worker >/dev/null 2>&1 || true

echo "4/7 promote the standby"
PROMOTE_START=$(date +%s)
docker exec "$STANDBY" psql -U herald -d herald -c "select pg_promote(true, 60)" >/dev/null

for _ in $(seq 1 60); do
  RECOVERY=$(docker exec "$STANDBY" psql -U herald -d herald -t -A -c "select pg_is_in_recovery()" | head -1)
  if [[ "$RECOVERY" == "f" ]]; then
    break
  fi
  sleep 1
done
PROMOTE_END=$(date +%s)
RTO=$((PROMOTE_END - PROMOTE_START))

echo "5/7 start the API and worker against the promoted node"
"${COMPOSE[@]}" up -d api-dr worker-dr >/dev/null

for _ in $(seq 1 60); do
  if curl -fsS http://localhost:3001/health/live >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

DRILL_READY=$(date +%s)
APP_RTO=$((DRILL_READY - DRILL_START))

echo "6/7 publish a new event and replay the outbox"
EVENT=$(curl -fsS -X POST http://localhost:3001/v1/events \
  -H "authorization: Bearer $BOOKING_KEY" \
  -H 'content-type: application/json' \
  -d "{\"type\":\"booking.confirmed\",\"schema_version\":1,\"recipient\":{\"external_id\":\"cust_00001\"},\"idempotency_key\":\"drill:$(date +%s)\",\"data\":{\"booking_id\":\"bkg_drill\",\"service\":\"plumbing\",\"pro_name\":\"Ravi\",\"scheduled_for\":\"2026-11-02T10:00:00+05:30\",\"address_label\":\"Home\"}}" || true)

for _ in $(seq 1 60); do
  PENDING=$(docker exec "$STANDBY" psql -U herald -d herald -t -A -c "select count(*) from outbox where published_at is null" | head -1)
  if [[ "$PENDING" == "0" ]]; then
    break
  fi
  sleep 1
done

AFTER=$(docker exec "$STANDBY" psql -U herald -d herald -t -A -c "select count(*) from notifications")

cat > "$RESULT" <<REPORT
# Postgres failover drill

- Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)
- Primary: $PRIMARY
- Promoted standby: $STANDBY
- Notifications before: $BEFORE
- Notifications after: $AFTER
- Replication lag before promotion: ${LAG:-unknown}s
- Promotion time: ${RTO}s
- Application RTO: ${APP_RTO}s
- Unpublished outbox rows after replay: ${PENDING:-unknown}
- New event response: ${EVENT:-none}

The drill covers streaming replication, standby promotion, application restart, and
outbox replay. Kafka and Redis remain single instances. It does not prove a full
regional failover.
REPORT

echo "7/7 drill complete"
cat "$RESULT"
