-- Read-only inventory. The runner executes it only on its disposable database.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SELECT rolname, rolsuper, rolcreaterole, rolbypassrls
FROM pg_catalog.pg_roles WHERE rolname IN ('service_role','anon','authenticated') ORDER BY rolname;
SELECT r.role, c.relname, pg_catalog.pg_get_userbyid(c.relowner) AS owner,
  c.relrowsecurity AS rls,
  has_table_privilege(r.role,c.oid,'SELECT') AS can_select,
  has_table_privilege(r.role,c.oid,'INSERT') AS can_insert,
  has_table_privilege(r.role,c.oid,'UPDATE') AS can_update,
  has_table_privilege(r.role,c.oid,'DELETE') AS can_delete,
  has_table_privilege(r.role,c.oid,'TRUNCATE') AS can_truncate,
  has_table_privilege(r.role,c.oid,'TRIGGER') AS can_create_trigger
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
CROSS JOIN (VALUES ('service_role'),('anon'),('authenticated')) AS r(role)
WHERE n.nspname='public' AND c.relname IN ('kora_records','kora_settings',
  'kora_article_generations','kora_article_generation_recoveries') ORDER BY c.relname,r.role;
SELECT p.oid::regprocedure AS function, pg_catalog.pg_get_userbyid(p.proowner) AS owner,
  p.prosecdef AS security_definer, p.proconfig,
  has_function_privilege('service_role',p.oid,'EXECUTE') AS service_execute,
  has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname LIKE 'kora_%' ORDER BY p.proname;
COMMIT;
