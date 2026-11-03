-- Synthetic historical dataset, in a SECOND disposable database at migration 0009.
-- Simulates rows existing before recovery association 0010 was introduced.
-- Never run against a real database. Contains no customer data.
BEGIN;
INSERT INTO public.kora_settings(workspace_id,data)
VALUES ('kora','{"workspaceId":"kora","quotaLimits":{"api_budget_eur":1},"reservedEur":0.03,"paidCallsSuspended":false,"notifiedAlerts":[],"storageBaseGb":0}'::jsonb);
INSERT INTO public.kora_records(collection,id,data) VALUES
('signals','hist43_signal_active',
 '{"id":"hist43_signal_active","status":"nouveau","articleId":null}'::jsonb),
('signals','hist43_signal_done',
 '{"id":"hist43_signal_done","status":"en_revue","articleId":"hist43_article_done"}'::jsonb),
('paid_attempts','hist43_attempt_active',
 '{"id":"hist43_attempt_active","workspaceId":"kora","month":"2026-11","kind":"generation_article","estimateEur":0.03,"units":1,"label":"historical active fixture","createdAt":"2026-11-03T00:00:00Z","status":"reserved","billingStatus":"not_sent","usageLines":[]}'::jsonb),
('paid_attempts','hist43_attempt_done',
 '{"id":"hist43_attempt_done","workspaceId":"kora","month":"2026-10","kind":"generation_article","estimateEur":0.01,"units":1,"label":"historical completed fixture","createdAt":"2026-10-03T00:00:00Z","status":"settled","billingStatus":"estimate_unverified","usageLines":[]}'::jsonb),
('http_idempotency',repeat('a',64),
 jsonb_build_object('id',repeat('a',64),'workspaceId','kora','actorId','historical-operator',
  'route','POST /articles','fingerprint',repeat('b',64),'state','pending',
  'createdAt','2026-11-03T00:00:00Z')),
('usage','hist43_usage',
 '{"id":"hist43_usage","at":"2026-10-03T00:00:00Z","kind":"generation_article","label":"historical usage","units":1,"costEur":0.008}'::jsonb),
('audit','hist43_audit',
 '{"id":"hist43_audit","action":"historical.fixture","actor":"TEST"}'::jsonb);
INSERT INTO public.kora_records(collection,id,data) VALUES
('articles','hist43_article_done',
 '{"id":"hist43_article_done","signalId":"hist43_signal_done","origin":"kora","status":"brouillon","currentVersion":1,"versions":[{}],"updatedAt":"2026-10-03T00:00:00Z"}'::jsonb);
-- The old 0008 table has NO http_operation_id column.
INSERT INTO public.kora_article_generations(signal_id,token,attempt_id,expected_signal,state,article_payload)
VALUES
('hist43_signal_active','a4300000-0000-4000-8000-000000000001',
 'hist43_attempt_active','{"id":"hist43_signal_active","status":"nouveau","articleId":null}'::jsonb,
 'reserved',NULL),
('hist43_signal_done','a4300000-0000-4000-8000-000000000002',
 'hist43_attempt_done','{"id":"hist43_signal_done","status":"nouveau","articleId":null}'::jsonb,
 'completed','{"id":"hist43_article_done","signalId":"hist43_signal_done","origin":"kora","status":"brouillon","currentVersion":1,"versions":[{}],"updatedAt":"2026-10-03T00:00:00Z"}'::jsonb);
COMMIT;
