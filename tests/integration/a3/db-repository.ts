/** Real DbRepository + PostgREST + PostgreSQL; run only via scripts/test-a3-postgres.sh. */
import assert from "node:assert/strict";
import { DbRepository } from "../../../src/server/store/db";
import { paidCall } from "../../../src/server/services/usage";
import { monthTotals } from "../../../src/server/domain/budget";
import { supabaseAdmin } from "../../../src/integrations/supabase/client.server";

async function main(): Promise<void> {
  assert.equal(process.env.A3_DB_ISOLATED_TEST, "1");
  const raw = process.env.SUPABASE_URL;
  assert.ok(raw, "Missing disposable PostgREST URL");
  const url = new URL(raw);
  assert.equal(url.protocol, "http:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.ok(!["54321", "55321"].includes(url.port), "Protected Supabase port");
  assert.ok(process.env.SUPABASE_SERVICE_ROLE_KEY, "Missing disposable JWT");

  const repo = new DbRepository();
  await repo.ensureReady();
  const settings = await repo.getSettings();
  assert.equal(repo.workspaceId, "kora");
  assert.equal(settings.reservedEur, 0);
  assert.equal(settings.quotaLimits.api_budget_eur, 0.05);
  assert.equal((await repo.usage.list()).length, 0);
  const now = new Date();
  const kind = "generation_summary" as const;
  const ctx = { repo, now, user: { id: "a3_ci_operator" } as never };

  // Settled: only measured cost is journalized, reservation released.
  const settled = await paidCall(
    ctx, { kind, estimate: 0.02, units: 1, label: "A3 settlement" },
    async () => "ok",
    () => [{ kind, costEur: 0.015, units: 1, label: "A3 settlement" }],
  );
  assert.equal(settled, "ok");
  assert.equal((await repo.getSettings()).reservedEur, 0);
  const usage = await repo.usage.list();
  assert.equal(usage.length, 1);
  assert.equal(usage[0]?.costEur, 0.015);
  assert.equal(monthTotals(usage, now.toISOString().slice(0, 7)).costEur, 0.015);

  // Overrun: persist the FULL estimate, hold reservation and do not write usage.
  const value = await paidCall(
    ctx, { kind, estimate: 0.02, units: 1, label: "A3 overrun" },
    async () => "result",
    () => [{ kind, costEur: 0.03, units: 1, label: "A3 overrun" }],
  );
  assert.equal(value, "result");
  assert.equal((await repo.usage.list()).length, 1);
  assert.equal((await repo.getSettings()).reservedEur, 0.02);
  const rows = await supabaseAdmin.from("kora_records").select("id,data").eq("collection", "paid_attempts");
  assert.equal(rows.error, null);
  const unknown = (rows.data ?? []).filter(
    (r) => (r.data as Record<string, unknown>)["failureCode"] === "estimated_overrun",
  );
  assert.equal(unknown.length, 1);
  const id = unknown[0]!.id;
  const attempt = await repo.paidAttempts.get(id);
  assert.equal(attempt?.status, "unknown");
  assert.equal(attempt?.estimatedCostEur, 0.03);
  assert.equal(attempt?.estimatedOverrunEur, 0.01);
  assert.equal(attempt?.estimatedUsageLines?.[0]?.costEur, 0.03);
  assert.equal(attempt?.usageLines.length, 0);
  await repo.paidAttempts.overrun(id, attempt.estimatedUsageLines!);
  await assert.rejects(
    repo.paidAttempts.overrun(id, [{ ...attempt.estimatedUsageLines![0]!, costEur: 0.04 }]),
  );

  // service_role may not perform administrator-only reconciliation.
  const denied = await supabaseAdmin.rpc(
    "kora_paid_reconcile" as never,
    { p_id: id, p_resolution: "not_billed", p_billed_eur: 0, p_evidence: {} } as never,
  );
  assert.ok(denied.error, "HTTP service_role unexpectedly allowed reconciliation");

  // Two concurrent reservations: spent .015 + held .02 leaves .015 of .05 budget.
  const base = {
    workspaceId: "kora", month: now.toISOString().slice(0, 7),
    kind, estimateEur: 0.01, units: 1,
    label: "A3 concurrency", createdAt: now.toISOString(),
  };
  const a = repo.nextId("pat"), b = repo.nextId("pat");
  const results = await Promise.all([
    repo.paidAttempts.reserve({ ...base, id: a }),
    repo.paidAttempts.reserve({ ...base, id: b }),
  ]);
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal((await repo.getSettings()).reservedEur, 0.03);
  await repo.paidAttempts.finish(results[0]!.ok ? a : b, [], "not_sent");
  assert.equal((await repo.getSettings()).reservedEur, 0.02);
  assert.equal((await repo.usage.list()).length, 1);
  console.log(JSON.stringify({
    event: "a3.db_repository.integration_pass",
    settledCostEur: 0.015, overrunCostEur: 0.03,
    retainedReserveEur: 0.02, concurrentReservationsAccepted: 1,
    reconciliationViaHttpDenied: true,
  }));
}
await main();
