#!/usr/bin/env bash
# Creates ONLY a fresh Docker Compose project and removes it on exit.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE="$ROOT/tests/integration/a3/docker-compose.yml"
DB="kora_a3_ci"
SECRET="kora-a3-isolated-jwt-secret-only-not-for-production-2026"
for tool in docker bun curl python3; do command -v "$tool" >/dev/null || { echo "Missing $tool" >&2; exit 1; }; done
docker compose version >/dev/null
test -s "$ROOT/tests/integration/a3/roles.sql"
test -s "$COMPOSE"
if [[ -n "$(printenv SUPABASE_URL || true)" || -n "$(printenv SUPABASE_SERVICE_ROLE_KEY || true)" ]]; then
  echo "STOP: inherited Supabase credentials: run with SUPABASE_URL= SUPABASE_SERVICE_ROLE_KEY=" >&2
  exit 1
fi
PROJECT="koraa3ci$(date -u +%s)$$"
compose() { docker compose --project-name "$PROJECT" --file "$COMPOSE" "$@"; }
cleanup() {
  local code=$? cleanup_failed=0 remaining_containers remaining_networks remaining_volumes
  trap - EXIT
  set +e
  echo "=== Nettoyage du projet temporaire : $PROJECT ==="
  compose down --volumes --remove-orphans
  if [[ $? -ne 0 ]]; then
    echo "ERREUR : docker compose down a échoué" >&2
    cleanup_failed=1
  fi
  remaining_containers="$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT")" || cleanup_failed=1
  remaining_networks="$(docker network ls -q --filter "label=com.docker.compose.project=$PROJECT")" || cleanup_failed=1
  remaining_volumes="$(docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT")" || cleanup_failed=1
  if [[ -n "$remaining_containers$remaining_networks$remaining_volumes" ]]; then
    echo "ERREUR : ressources du projet encore présentes" >&2
    cleanup_failed=1
  fi
  if [[ $cleanup_failed -eq 0 ]]; then
    echo "PASS : aucun conteneur, réseau ou volume du projet ne reste"
  else
    echo "ECHEC : nettoyage non confirmé pour $PROJECT" >&2
    [[ $code -ne 0 ]] || code=1
  fi
  exit "$code"
}
trap cleanup EXIT
echo "=== Disposable A3 project: $PROJECT ==="
compose up --detach --wait db
sql() { compose exec -T db psql -X -v ON_ERROR_STOP=1 -U postgres -d "$DB"; }
for m in 0000_kora_records 0002_kora_paid_attempts 0003_kora_settings_safe_write 0004_kora_paid_reconcile 0005_kora_paid_overrun 0006_kora_paid_accounting_guards 0007_kora_http_idempotency 0008_kora_article_generations 0009_kora_signal_mutations; do
  f="$ROOT/drizzle/migrations/$m.sql"
  test -s "$f"
  echo "Applying $m (disposable DB ONLY)"
  sql < "$f" >/dev/null
done
sql <<'SQL' >/dev/null
INSERT INTO public.kora_settings(workspace_id,data)
VALUES ('kora',jsonb_build_object(
 'workspaceId','kora',
 'quotaLimits',jsonb_build_object(
  'api_budget_eur',0.05,'search_queries',3000,'observations',6000,
  'articles',25,'linkedin_posts',25,'newsletters',5,'companies',150,
  'sources',300,'storage_gb',10
 ),
 'reservedEur',0,'paidCallsSuspended',false,
 'suspendedMonth',NULL,'notifiedAlerts','[]'::jsonb,'storageBaseGb',0
));
DO $$
BEGIN
 IF NOT has_function_privilege('service_role','public.kora_paid_overrun(text,jsonb)','EXECUTE')
    OR has_function_privilege('service_role','public.kora_paid_reconcile(text,text,numeric,jsonb)','EXECUTE')
    OR has_function_privilege('anon','public.kora_paid_overrun(text,jsonb)','EXECUTE')
 THEN RAISE EXCEPTION 'invalid financial RPC privileges'; END IF;
END $$;
SQL
echo "=== A4 SQL transaction and ownership checks (disposable DB ONLY) ==="
sql < "$ROOT/tests/integration/a3/article-generations.sql"
echo "=== A4.2 SQL atomic merge/split rollback checks (disposable DB ONLY) ==="
sql < "$ROOT/tests/integration/a3/signal-mutations.sql"
echo "=== A4.3.1 recovery characterization (disposable DB ONLY) ==="
sql < "$ROOT/tests/integration/a3/recovery-characterization.sql"
compose up --detach api
endpoint="$(compose port api 3000)"
port="$(printf '%s\n' "$endpoint" | sed -E 's/^.*:([0-9]+)$/\1/')"
[[ "$port" =~ ^[0-9]+$ && "$port" -gt 1024 ]] || { echo "Invalid ephemeral port" >&2; exit 1; }
[[ "$port" != "54321" && "$port" != "55321" ]] || { echo "STOP: protected Supabase port" >&2; exit 1; }
url="http://127.0.0.1:$port"
ready=0
for i in $(seq 1 45); do
  code="$(curl --silent --output /dev/null --max-time 2 --write-out '%{http_code}' "$url/" || true)"
  if [[ "$code" =~ ^[234][0-9][0-9]$ ]]; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == "1" ]] || { echo "PostgREST not ready" >&2; compose logs --tail 35 api >&2; exit 1; }
jwt="$(A3_TEST_SECRET="$SECRET" bun --no-env-file -e '
import { createHmac } from "node:crypto";
const enc = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
const payload = enc({alg:"HS256",typ:"JWT"})+"."+enc({role:"service_role",exp:Math.floor(Date.now()/1000)+900});
process.stdout.write(payload+"."+createHmac("sha256",process.env.A3_TEST_SECRET).update(payload).digest("base64url"));
')"
test -n "$jwt"
echo "=== Real DbRepository through disposable PostgREST ==="
(
 cd "$ROOT"
 env -u ANTHROPIC_API_KEY -u AI_API_KEY -u PERPLEXITY_API_KEY -u LOVABLE_DB_MIGRATION_URL \
   SUPABASE_URL="$url" SUPABASE_SERVICE_ROLE_KEY="$jwt" A3_DB_ISOLATED_TEST=1 \
   bun --no-env-file tests/integration/a3/db-repository.ts
)
echo "=== DBA-only reconciliation on disposable DB ==="
sql <<'SQL'
DO $$
DECLARE v_id text; v_state jsonb; v_reserved numeric; v_usage integer;
BEGIN
 SELECT id INTO STRICT v_id FROM public.kora_records
 WHERE collection='paid_attempts' AND data->>'failureCode'='estimated_overrun';
 PERFORM public.kora_paid_reconcile(
  v_id,'billed',0.03,
  jsonb_build_object('source','provider_invoice','reference','TEST-ISOLATED-2026',
  'operator','a3-ci-operator','sha256',repeat('a',64),'currency','EUR',
  'checkedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
 );
 SELECT data INTO STRICT v_state FROM public.kora_records
  WHERE collection='paid_attempts' AND id=v_id;
 SELECT (data->>'reservedEur')::numeric INTO STRICT v_reserved
  FROM public.kora_settings WHERE workspace_id='kora';
 SELECT count(*) INTO v_usage FROM public.kora_records WHERE collection='usage';
 IF v_state->>'status'<>'reconciled_billed' OR v_reserved<>0
   OR v_usage<>2 OR (v_state->'reconciliation'->>'billedEur')::numeric<>0.03
 THEN RAISE EXCEPTION 'reconciliation mismatch'; END IF;
 RAISE NOTICE 'PASS: DBA reconciliation, 2 usage rows, zero reserve';
END $$;
SQL
# The concurrency fixture deliberately suspended paid calls. Reset ONLY that fixture
# after all financial assertions; application settings writes cannot clear this flag.
sql <<'SQL'
UPDATE public.kora_settings
SET data = data || '{"paidCallsSuspended":false,"suspendedMonth":null}'::jsonb
WHERE workspace_id='kora';
SQL
bunx tsc --noEmit -p "$ROOT/tests/integration/a3/tsconfig.json"
echo "=== A3.1 real HTTP loss and process restart (disposable DB ONLY) ==="
(
 cd "$ROOT"
 env -u ANTHROPIC_API_KEY -u AI_API_KEY -u PERPLEXITY_API_KEY -u LOVABLE_DB_MIGRATION_URL -u VITEST \
   SUPABASE_URL="$url" SUPABASE_SERVICE_ROLE_KEY="$jwt" A3_DB_ISOLATED_TEST=1 \
   bun --no-env-file tests/integration/a3/http-e2e.ts
)
echo "PASS: disposable DB integration and HTTP system tests; cleanup on script exit"
