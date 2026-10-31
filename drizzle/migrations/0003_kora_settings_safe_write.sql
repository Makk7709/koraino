-- A3: preserve financial state when saving stale application settings.
CREATE OR REPLACE FUNCTION public.kora_settings_save(p_data jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER
SET search_path = '' SET lock_timeout = '3s'
AS $$
DECLARE
 v_current jsonb;
 v_alerts jsonb;
BEGIN
 IF jsonb_typeof(p_data) IS DISTINCT FROM 'object'
    OR p_data->>'workspaceId' IS DISTINCT FROM 'kora'
    OR jsonb_typeof(p_data->'quotaLimits') IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_data->'notifiedAlerts') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_data->'storageBaseGb') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_data->'quotaLimits'->'api_budget_eur') IS DISTINCT FROM 'number'
    OR (p_data->>'storageBaseGb')::numeric < 0
    OR (p_data->'quotaLimits'->>'api_budget_eur')::numeric < 0
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_data->'notifiedAlerts') AS a
               WHERE jsonb_typeof(a.value) IS DISTINCT FROM 'string')
 THEN RAISE EXCEPTION 'invalid settings payload'; END IF;
 SELECT data INTO STRICT v_current FROM public.kora_settings
  WHERE workspace_id = 'kora' FOR UPDATE;
 SELECT COALESCE(jsonb_agg(to_jsonb(a.value) ORDER BY a.value), '[]'::jsonb)
 INTO v_alerts FROM (
  SELECT DISTINCT value FROM (
   SELECT jsonb_array_elements_text(COALESCE(v_current->'notifiedAlerts','[]'::jsonb)) AS value
   UNION ALL
   SELECT jsonb_array_elements_text(p_data->'notifiedAlerts') AS value
  ) AS combined
 ) AS a;
 UPDATE public.kora_settings
 SET data = (v_current - 'wordpress') || jsonb_build_object(
    'quotaLimits', p_data->'quotaLimits',
    'storageBaseGb', p_data->'storageBaseGb',
    'notifiedAlerts', v_alerts
  ), updated_at = clock_timestamp()
 WHERE workspace_id = 'kora';
 RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.kora_settings_save(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kora_settings_save(jsonb) TO service_role;
