-- A3/P1-11: controlled manual reconciliation of attempts with unknown billability.
-- NOT an automatic timeout handler. The operator must independently verify evidence.
-- This function is DBA-only, not callable from the KORA service-role HTTP API.
-- Requires public.kora_records / kora_settings and the 0002 paid-attempt migration.

CREATE OR REPLACE FUNCTION public.kora_paid_reconcile(
  p_id text,
  p_resolution text,
  p_billed_eur numeric,
  p_evidence jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
SET lock_timeout = '3s'
AS $$
DECLARE
  v_settings jsonb;
  v_attempt jsonb;
  v_estimate numeric;
  v_reserved numeric;
  v_spent numeric;
  v_limit numeric;
  v_month text;
  v_at text;
  v_audit_at text;
  v_status text;
  v_over_budget boolean;
  v_ledger jsonb := '[]'::jsonb;
  v_expected_resolution jsonb;
  v_source text;
  v_reference text;
  v_operator text;
  v_evidence_hash text;
  v_checked_at timestamptz;
BEGIN
  -- The service_role key must never be sufficient to reconcile a disputed charge.
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'reconciliation requires a database administrator';
  END IF;

  IF p_id IS NULL OR length(p_id) < 5 OR length(p_id) > 200
     OR p_resolution IS NULL OR p_resolution NOT IN ('billed','not_billed')
     OR p_billed_eur IS NULL OR p_billed_eur < 0 OR p_billed_eur > 100000
     OR round(p_billed_eur, 4) <> p_billed_eur
     OR (p_resolution = 'billed' AND p_billed_eur = 0)
     OR (p_resolution = 'not_billed' AND p_billed_eur <> 0)
     OR jsonb_typeof(p_evidence) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid reconciliation request';
  END IF;

  v_source := p_evidence->>'source';
  v_reference := btrim(COALESCE(p_evidence->>'reference', ''));
  v_operator := btrim(COALESCE(p_evidence->>'operator', ''));
  v_evidence_hash := p_evidence->>'sha256';
  IF v_source IS NULL OR v_source NOT IN ('provider_invoice', 'provider_usage_export', 'provider_support_confirmation')
     OR length(v_reference) < 6 OR length(v_reference) > 256
     OR length(v_operator) < 3 OR length(v_operator) > 128
     OR v_evidence_hash IS NULL OR v_evidence_hash !~ '^[0-9a-f]{64}$'
     OR p_evidence->>'currency' IS DISTINCT FROM 'EUR'
     OR p_evidence->>'checkedAt' IS NULL
     OR p_evidence->>'checkedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' THEN
    RAISE EXCEPTION 'incomplete reconciliation evidence';
  END IF;
  v_checked_at := (p_evidence->>'checkedAt')::timestamptz;
  IF v_checked_at > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'reconciliation evidence date is in the future';
  END IF;

  -- Keep this lock order aligned with kora_paid_finish and kora_paid_reserve.
  SELECT data INTO STRICT v_settings FROM public.kora_settings
    WHERE workspace_id = 'kora' FOR UPDATE;
  SELECT data INTO STRICT v_attempt FROM public.kora_records
    WHERE collection = 'paid_attempts' AND id = p_id FOR UPDATE;

  v_status := v_attempt->>'status';
  v_expected_resolution := jsonb_build_object(
    'resolution', p_resolution, 'billedEur', p_billed_eur, 'evidence', p_evidence
  );
  IF v_status IN ('reconciled_billed', 'reconciled_not_billed') THEN
    -- Exactly identical replay is a no-op. Different evidence/cost always fails closed.
    IF v_attempt->'reconciliation' = v_expected_resolution THEN RETURN true; END IF;
    RAISE EXCEPTION 'reconciliation replay conflict';
  END IF;
  IF v_status IS DISTINCT FROM 'unknown' THEN
    RAISE EXCEPTION 'only unknown attempts can be reconciled';
  END IF;
  IF v_attempt->>'workspaceId' IS DISTINCT FROM 'kora' THEN
    RAISE EXCEPTION 'attempt workspace mismatch';
  END IF;

  v_estimate := (v_attempt->>'estimateEur')::numeric;
  v_reserved := (v_settings->>'reservedEur')::numeric;
  v_month := v_attempt->>'month';
  v_limit := (v_settings->'quotaLimits'->>'api_budget_eur')::numeric;
  IF v_month IS NULL OR v_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
     OR v_estimate IS NULL OR v_estimate <= 0
     OR v_reserved IS NULL OR v_reserved + 0.000000001 < v_estimate
     OR v_limit IS NULL OR v_limit < 0
     OR v_attempt->>'kind' IS NULL OR v_attempt->>'label' IS NULL
     OR jsonb_typeof(v_attempt->'units') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'inconsistent financial state: manual investigation required';
  END IF;

  v_audit_at := to_char(clock_timestamp() AT TIME ZONE 'UTC',
                        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  -- Accounting month deliberately follows the original reservation month.
  -- The real call timestamp is retained in the attempt, reconciliation time in audit.
  v_at := v_month || '-01T00:00:00.000Z';
  SELECT COALESCE(SUM((r.data->>'costEur')::numeric),0) INTO v_spent
    FROM public.kora_records r
    WHERE r.collection = 'usage' AND left(r.data->>'at',7) = v_month;

  v_over_budget := v_spent + (v_reserved - v_estimate) + p_billed_eur
                   > v_limit + 0.000000001;
  IF p_resolution = 'billed' THEN
    v_ledger := jsonb_build_array(jsonb_build_object(
      'id', p_id || ':line:0',
      'at', v_at,
      'kind', v_attempt->>'kind',
      'units', COALESCE((v_attempt->>'units')::numeric,0),
      'costEur', p_billed_eur,
      'label', v_attempt->>'label',
      'accountingSource', 'provider_reconciliation',
      'unitsBasis', 'original_estimate'
    ));
    INSERT INTO public.kora_records(collection, id, data)
    VALUES ('usage', p_id || ':line:0', v_ledger->0);
  END IF;

  UPDATE public.kora_records
     SET data = v_attempt || jsonb_build_object(
       'status', CASE WHEN p_resolution='billed' THEN 'reconciled_billed'
                      ELSE 'reconciled_not_billed' END,
       'billingStatus', CASE WHEN p_resolution='billed' THEN 'provider_confirmed'
                            ELSE 'confirmed_not_charged' END,
       'usageLines', v_ledger,
       'reconciliation', v_expected_resolution,
       'budgetOverrunAtReconciliation', v_over_budget,
       'completedAt', v_audit_at
     ), updated_at = clock_timestamp()
   WHERE collection = 'paid_attempts' AND id = p_id;

  UPDATE public.kora_settings
     SET data = jsonb_set(v_settings, '{reservedEur}',
       to_jsonb(round(v_reserved - v_estimate, 4))),
         updated_at = clock_timestamp()
   WHERE workspace_id='kora';

  -- Never silently reactivate paid calls after a reconciliation.
  -- Suspend additional current-month calls on a confirmed overrun.
  IF v_over_budget AND v_month = to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM') THEN
    UPDATE public.kora_settings
      SET data = jsonb_set(jsonb_set(data, '{paidCallsSuspended}', 'true'::jsonb),
          '{suspendedMonth}', to_jsonb(v_month)),
          updated_at = clock_timestamp()
      WHERE workspace_id='kora';
  END IF;

  INSERT INTO public.kora_records(collection,id,data)
  VALUES ('audit', 'aud_paid_reconcile_' || p_id, jsonb_build_object(
    'id', 'aud_paid_reconcile_' || p_id,
    'at', v_audit_at,
    'actor', v_operator,
    'action', 'quota.paid_reconciliation',
    'entity', 'quota',
    'entityId', p_id,
    'details', jsonb_build_object(
       'resolution', p_resolution, 'billedEur', p_billed_eur,
       'source', v_source, 'reference', v_reference,
       'sha256', v_evidence_hash, 'overBudget', v_over_budget
    )::text
  ));
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.kora_paid_reconcile(text,text,numeric,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
-- No GRANT to service_role: manual DBA operation only.
