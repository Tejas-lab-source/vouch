#!/usr/bin/env bash
# Phase 14 load test: 10x the beta peak on the beta plan's resources (load/README.md).
#   load/run.sh [duration_s=300] [scale=1]
# Needs Docker, Node 24 and the API image (LOAD_API_IMAGE, default vouch-api:load).
set -euo pipefail
cd "$(dirname "$0")/.."
# Node 24 (the repository's engine), when installed at the CI/cloud path.
[ -x /opt/node24/bin/node ] && export PATH="/opt/node24/bin:$PATH"
DURATION_S="${1:-300}"
SCALE="${2:-1}"
OUT=load/out
mkdir -p "$OUT"
rm -f "$OUT/samples.jsonl" "$OUT/summary.json"

# A throwaway environment for this run only (git-ignored): fresh keys, a random DB password,
# console providers, and rate limits high enough that capacity, not the limiter, is measured.
if [ ! -f load/load.env ]; then
  keys="$(node scripts/dev-keys.js)"
  {
    # Development mode: production refuses the console/dev providers this test uses (no real
    # email, push or moderation calls). The only difference on the request path is /docs.
    echo "NODE_ENV=development"
    echo "LOG_LEVEL=warn"
    echo "PORT=3000"
    echo "METRICS_PORT=9464"
    echo "LOAD_DB_PASSWORD=$(node -e "process.stdout.write(require('node:crypto').randomBytes(12).toString('hex'))")"
    echo "$keys"
    grep -E '^(EMAIL_PROVIDER|CAPTCHA_PROVIDER|MODERATION_PROVIDER|PRIVACY_NOTICE_VERSION|DISCOVERY_|PHOTOS_MAX|UPLOAD_|IMAGE_|R2_|CDN_BASE_URL|SOCKET_REFRESH|CHAT_MAX)' .env.example
    echo "EMAIL_HMAC_SECRET=$(node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('hex'))")"
    echo "COOKIE_SECRET=$(node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('hex'))")"
    echo "RATE_LIMIT_USER_MINUTE=100000"
    echo "RATE_LIMIT_IP_MINUTE=100000000"
    echo "RATE_LIMIT_MESSAGES_MINUTE=100000"
  } > load/load.env
fi
# Read values verbatim (sourcing the file would strip the quotes inside the JSON keys).
envval() { grep -m1 "^$1=" load/load.env | cut -d= -f2-; }
LOAD_DB_PASSWORD="$(envval LOAD_DB_PASSWORD)"

compose() { docker compose -f load/compose.yml --env-file load/load.env "$@"; }
compose down -v --remove-orphans >/dev/null 2>&1 || true
compose up -d --wait postgres redis
compose run --rm --no-deps api node migrations/run.js up
DATABASE_URL="postgres://vouch:${LOAD_DB_PASSWORD}@127.0.0.1:55432/vouch" \
  JWT_SIGNING_KEYS="$(envval JWT_SIGNING_KEYS)" JWT_ACTIVE_KID="$(envval JWT_ACTIVE_KID)" \
  node apps/api/scripts/load-prepare.js --pairs 500 --hours 3
compose exec -T postgres psql -U vouch -d vouch -qc 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements'
compose up -d --wait api
compose exec -T postgres psql -U vouch -d vouch -qc 'SELECT pg_stat_statements_reset()'

node load/sample.js "$((DURATION_S + 90))" &
SAMPLER=$!

# Chaos (CHAOS=1): SIGKILL the API (API, gateway and worker: one process in the beta), then
# Redis, and time each recovery. Gateway-only and worker-only kills are invariant tests.
ready_after() {
  local start=$(date +%s%N)
  until curl -fsS --max-time 5 http://127.0.0.1:53000/ready >/dev/null 2>&1; do sleep 0.2; done
  echo $(( ($(date +%s%N) - start) / 1000000 ))
}
chaos() {
  sleep 90
  echo "{\"event\":\"kill api\",\"at\":\"$(date -Is)\"}" >> "$OUT/chaos.jsonl"
  docker kill -s KILL vouch-load-api-1 >/dev/null
  compose up -d api >/dev/null 2>&1
  echo "{\"event\":\"api ready again\",\"ms\":$(ready_after)}" >> "$OUT/chaos.jsonl"
  sleep 60
  echo "{\"event\":\"kill redis\",\"at\":\"$(date -Is)\"}" >> "$OUT/chaos.jsonl"
  docker kill -s KILL vouch-load-redis-1 >/dev/null
  sleep 10
  compose up -d redis >/dev/null 2>&1
  echo "{\"event\":\"api ready after redis\",\"ms\":$(ready_after)}" >> "$OUT/chaos.jsonl"
}
if [ "${CHAOS:-0}" = 1 ]; then rm -f "$OUT/chaos.jsonl"; chaos & CHAOS_PID=$!; fi
docker run --rm --network vouch-load_default \
  -v "$PWD/load:/load:ro" -v "$PWD/$OUT:/out" -w /load/k6 \
  -u "$(id -u):$(id -g)" -e BASE_URL=http://api:3000 -e DURATION_S="$DURATION_S" -e SCALE="$SCALE" \
  grafana/k6:1.3.0 run --quiet beta-10x.js | tee "$OUT/k6.txt" || true
wait "$SAMPLER" || true
if [ "${CHAOS:-0}" = 1 ]; then
  wait "$CHAOS_PID" || true
  # After recovery: the outbox drains, and every acknowledged message is stored.
  for _ in $(seq 1 60); do
    backlog=$(compose exec -T postgres psql -U vouch -d vouch -At -c \
      'SELECT count(*) FROM platform.outbox WHERE published_at IS NULL')
    [ "$backlog" = 0 ] && break; sleep 2
  done
  stored=$(compose exec -T postgres psql -U vouch -d vouch -At -c 'SELECT count(*) FROM chat.messages')
  echo "{\"event\":\"after\",\"outboxBacklog\":$backlog,\"messagesStored\":$stored}" >> "$OUT/chaos.jsonl"
fi

# The top 10 queries by total time, for EXPLAIN ANALYZE (docs/performance/phase-14-report.md).
compose exec -T postgres psql -U vouch -d vouch -At -F $'\t' -c "
  SELECT calls, round(total_exec_time)::int, round(mean_exec_time::numeric, 2), rows,
         regexp_replace(query, '\s+', ' ', 'g')
  FROM pg_stat_statements WHERE query NOT ILIKE '%pg_stat_statements%'
  ORDER BY total_exec_time DESC LIMIT 10" > "$OUT/top-queries.tsv"
compose logs --no-color api > "$OUT/api.log" 2>&1 || true
[ "${KEEP_STACK:-0}" = 1 ] || compose down -v --remove-orphans
echo "results in $OUT/ (summary.json, samples.jsonl, top-queries.tsv)"
