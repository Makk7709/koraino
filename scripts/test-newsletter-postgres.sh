#!/usr/bin/env bash
# P0-01 only: fresh, disposable PostgreSQL/PostgREST; never an existing database.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
for tool in docker bun python3 timeout; do command -v "$tool" >/dev/null || exit 1; done
if [[ -n "${SUPABASE_URL:-}${SUPABASE_SERVICE_ROLE_KEY:-}${DATABASE_URL:-}" ]]; then
  echo 'STOP: inherited database credentials' >&2; exit 1
fi
PROJECT="koranlci$(date -u +%s)$$"
compose() { docker compose --project-name "$PROJECT" --file "$ROOT/tests/integration/a3/docker-compose.yml" "$@"; }
cleanup() {
  local code=$?
  trap - EXIT
  if [[ "$code" -ne 0 ]]; then compose logs --tail 80 api db || true; fi
  compose down --volumes --remove-orphans || { [[ "$code" -ne 0 ]] || code=1; }
  exit "$code"
}
trap cleanup EXIT
compose up --detach --wait db
sql() { compose exec -T db psql -X -v ON_ERROR_STOP=1 -U postgres -d kora_a3_ci --single-transaction -f -; }
for f in "$ROOT"/drizzle/migrations/00*.sql; do
  [[ "$f" == *0001_app_user_connections.sql ]] && continue
  sql < "$f" >/dev/null
done
compose up --detach --wait api
port="$(compose port api 3000 | sed -E 's/^.*:([0-9]+)$/\1/')"
pgport="$(compose port db 5432 | sed -E 's/^.*:([0-9]+)$/\1/')"
[[ "$port" =~ ^[0-9]+$ && "$pgport" =~ ^[0-9]+$ ]] || exit 1
SECRET='kora-a3-isolated-jwt-secret-only-not-for-production-2026'
jwt="$(A3_TEST_SECRET="$SECRET" bun --no-env-file -e '
import { createHmac } from "node:crypto";
const enc = v => Buffer.from(JSON.stringify(v)).toString("base64url");
const payload = enc({alg:"HS256",typ:"JWT"})+"."+enc({role:"service_role",exp:Math.floor(Date.now()/1000)+900});
process.stdout.write(payload+"."+createHmac("sha256",process.env.A3_TEST_SECRET).update(payload).digest("base64url"));
')"
cd "$ROOT"
bunx tsc --noEmit -p tests/integration/newsletter/tsconfig.json
timeout --signal=TERM --kill-after=10s 120s env -u ANTHROPIC_API_KEY -u AI_API_KEY -u PERPLEXITY_API_KEY -u VITEST \
  SUPABASE_URL="http://127.0.0.1:$port" SUPABASE_SERVICE_ROLE_KEY="$jwt" A3_DB_ISOLATED_TEST=1 \
  NL_TEST_PG_URL="postgres://postgres:a3-ci-postgres-only@127.0.0.1:$pgport/kora_a3_ci" \
  bun --no-env-file tests/integration/newsletter/concurrency.ts
