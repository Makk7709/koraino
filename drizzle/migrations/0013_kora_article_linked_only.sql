-- A4.3.5: close the legacy unlinked A4 budget-reservation entry point.
-- The postgres-owned SECURITY DEFINER reserve_linked RPC still calls this helper
-- internally, but no application role may invoke it directly.
-- ACL-only additive migration: existing historical claims and ledgers are unchanged.
REVOKE ALL ON FUNCTION public.kora_article_generation_reserve(uuid,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
