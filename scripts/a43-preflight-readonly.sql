-- A4.3 change preflight, strictly READ ONLY, on a protected snapshot/clone.
-- No customer-level rows, secrets or full JSON documents are returned.
-- The output is evidence to review, never automatic authorization to migrate.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';
SELECT 'database_identity' AS section, current_database() AS db_name,
       current_user AS inspected_as,
       current_setting('server_version') AS postgres_version;
SELECT 'required_objects' AS section, x.object_name, pg_catalog.to_regclass(x.object_name) IS NOT NULL AS exists
FROM (VALUES ('public.kora_records'),('public.kora_settings'),
 ('public.kora_article_generations'),('public.kora_article_generation_recoveries'),
 ('public.app_user_connections')) x(object_name);
SELECT 'role_inventory' AS section, rolname, rolsuper, rolcreaterole, rolbypassrls
FROM pg_catalog.pg_roles WHERE rolname IN ('postgres','service_role','anon','authenticated')
ORDER BY rolname;
SELECT 'schema_privileges' AS section, rolname,
 has_schema_privilege(rolname,'public','CREATE') AS can_create_in_public,
 has_schema_privilege(rolname,'public','USAGE') AS can_use_public
FROM pg_catalog.pg_roles WHERE rolname IN ('service_role','anon','authenticated')
ORDER BY rolname;
SELECT 'table_privileges' AS section, c.relname,
 pg_catalog.pg_get_userbyid(c.relowner) AS owner,
 r.rolname AS role_name, c.relrowsecurity AS rls_enabled,
 has_table_privilege(r.rolname,c.oid,'SELECT') AS can_select,
 has_table_privilege(r.rolname,c.oid,'INSERT') AS can_insert,
 has_table_privilege(r.rolname,c.oid,'UPDATE') AS can_update,
 has_table_privilege(r.rolname,c.oid,'DELETE') AS can_delete,
 has_table_privilege(r.rolname,c.oid,'TRUNCATE') AS can_truncate,
 has_table_privilege(r.rolname,c.oid,'TRIGGER') AS can_trigger,
 has_table_privilege(r.rolname,c.oid,'REFERENCES') AS can_reference
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
CROSS JOIN pg_catalog.pg_roles r
WHERE n.nspname='public'
 AND c.relname IN ('kora_records','kora_settings',
   'kora_article_generations','kora_article_generation_recoveries')
 AND r.rolname IN ('service_role','anon','authenticated')
ORDER BY c.relname,r.rolname;
SELECT 'sql_functions' AS section, p.oid::regprocedure AS signature,
 pg_catalog.pg_get_userbyid(p.proowner) AS owner,
 p.prosecdef AS security_definer, p.proconfig AS function_settings,
 has_function_privilege('service_role',p.oid,'EXECUTE') AS service_can_execute,
 has_function_privilege('anon',p.oid,'EXECUTE') AS anon_can_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_can_execute
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname LIKE 'kora_%'
ORDER BY p.proname,p.oid::regprocedure::text;
SELECT 'collection_counts' AS section, collection, count(*) AS row_count
FROM public.kora_records
WHERE collection IN ('paid_attempts','usage','audit','signals','articles','http_idempotency')
GROUP BY collection ORDER BY collection;
SELECT 'financial_state_counts' AS section,
 data->>'status' AS status, data->>'billingStatus' AS billing_status,
 count(*) AS row_count
FROM public.kora_records
WHERE collection='paid_attempts'
GROUP BY data->>'status',data->>'billingStatus'
ORDER BY status,billing_status;
SELECT 'http_state_counts' AS section, data->>'state' AS http_state,
 count(*) AS row_count
FROM public.kora_records WHERE collection='http_idempotency'
GROUP BY data->>'state' ORDER BY http_state;
SELECT 'settings_shape' AS section, workspace_id,
 jsonb_typeof(data) AS json_type,
 jsonb_typeof(data->'quotaLimits') AS quota_json_type,
 jsonb_typeof(data->'reservedEur') AS reserve_json_type,
 jsonb_typeof(data->'notifiedAlerts') AS alerts_json_type,
 (data ? 'wordpress') AS legacy_wordpress_inline
FROM public.kora_settings ORDER BY workspace_id;
-- Type check uses text/regex rather than casting untrusted historical JSON.
SELECT 'financial_shape_anomalies' AS section,
 count(*) FILTER (WHERE jsonb_typeof(data) IS DISTINCT FROM 'object') AS invalid_json_objects,
 count(*) FILTER (WHERE jsonb_typeof(data->'estimateEur') IS DISTINCT FROM 'number') AS invalid_estimates,
 count(*) FILTER (WHERE data->>'status' NOT IN
    ('reserved','in_flight','unknown','settled','not_sent','reconciled_billed','reconciled_not_billed')
    OR data->>'status' IS NULL) AS unexpected_statuses
FROM public.kora_records WHERE collection='paid_attempts';
-- The next query dynamically checks optional A4 columns before migration 0010.
SELECT 'article_generation_catalog' AS section, c.column_name, c.data_type
FROM information_schema.columns c
WHERE c.table_schema='public' AND c.table_name='kora_article_generations'
 AND c.column_name IN ('signal_id','attempt_id','http_operation_id','state')
ORDER BY c.ordinal_position;
SELECT 'constraints_and_triggers' AS section, t.tgrelid::regclass AS relation,
 t.tgname, t.tgenabled AS enabled
FROM pg_catalog.pg_trigger t
WHERE NOT t.tgisinternal AND t.tgrelid IN
 (SELECT c.oid FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname IN
   ('kora_records','kora_settings','kora_article_generations'))
ORDER BY relation::text,t.tgname;
COMMIT;
