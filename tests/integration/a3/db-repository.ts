/** Real DbRepository + PostgREST + PostgreSQL; run only via scripts/test-a3-postgres.sh. */
import assert from "node:assert/strict";
import { setClock } from "../../../src/server/clock";
import { DbRepository } from "../../../src/server/store/db";
import { paidCall } from "../../../src/server/services/usage";
import { monthTotals } from "../../../src/server/domain/budget";
import { supabaseAdmin } from "../../../src/integrations/supabase/client.server";

async function main(): Promise<void> {
  assert.equal(process.env["A3_DB_ISOLATED_TEST"], "1");
  const raw = process.env["SUPABASE_URL"];
  assert.ok(raw, "Missing disposable PostgREST URL");
  const url = new URL(raw);
  assert.equal(url.protocol, "http:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.ok(!["54321", "55321"].includes(url.port), "Protected Supabase port");
  assert.ok(process.env["SUPABASE_SERVICE_ROLE_KEY"], "Missing disposable JWT");

  // Supabase-js targets /rest/v1; standalone PostgREST exposes the same routes at /.
  // Rewrite only requests to this disposable loopback server.
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const target = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(target.origin, url.origin, "Unexpected external request");
    assert.ok(target.pathname.startsWith("/rest/v1/"), "Unexpected API path");
    target.pathname = target.pathname.slice("/rest/v1".length);
    if (input instanceof Request) {
      return nativeFetch(new Request(target, input), init);
    }
    return nativeFetch(target, init);
  };
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
    ctx,
    { kind, estimate: 0.02, units: 1, label: "A3 settlement" },
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
    ctx,
    { kind, estimate: 0.02, units: 1, label: "A3 overrun" },
    async () => "result",
    () => [{ kind, costEur: 0.03, units: 1, label: "A3 overrun" }],
  );
  assert.equal(value, "result");
  assert.equal((await repo.usage.list()).length, 1);
  assert.equal((await repo.getSettings()).reservedEur, 0.02);
  const rows = await supabaseAdmin
    .from("kora_records")
    .select("id,data")
    .eq("collection", "paid_attempts");
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
  await assert.rejects(repo.paidAttempts.unknown(id, "persist_error"));
  assert.equal((await repo.paidAttempts.get(id))?.failureCode, "estimated_overrun");
  await assert.rejects(
    repo.paidAttempts.overrun(id, [{ ...attempt.estimatedUsageLines![0]!, costEur: 0.04 }]),
  );

  // A4.3.3: exercise the real HTTP data API with its BYPASSRLS service JWT.
  // Each request must return PostgreSQL insufficient_privilege, without any mutation.
  const beforeProtection = {
    attempt: await repo.paidAttempts.get(id),
    settings: await repo.getSettings(),
    usage: await repo.usage.list(),
  };
  const protectedHttpId = "43".repeat(32);
  await repo.idempotency.begin({
    id: protectedHttpId,
    workspaceId: "kora",
    actorId: "a433-http-test",
    route: "POST /articles",
    fingerprint: "34".repeat(32),
  });
  const expectDenied = async (
    label: string,
    request: PromiseLike<{ error: { code?: string } | null }>,
  ): Promise<void> => {
    const response = await request;
    assert.equal(response.error?.code, "42501", label);
  };
  await expectDenied(
    "direct paid attempt update",
    supabaseAdmin
      .from("kora_records")
      .update({ data: { status: "reserved" } })
      .eq("collection", "paid_attempts")
      .eq("id", id)
      .abortSignal(AbortSignal.timeout(10_000)),
  );
  await expectDenied(
    "direct HTTP deletion",
    supabaseAdmin
      .from("kora_records")
      .delete()
      .eq("collection", "http_idempotency")
      .eq("id", protectedHttpId)
      .abortSignal(AbortSignal.timeout(10_000)),
  );
  await expectDenied(
    "direct usage deletion",
    supabaseAdmin
      .from("kora_records")
      .delete()
      .eq("collection", "usage")
      .abortSignal(AbortSignal.timeout(10_000)),
  );
  await expectDenied(
    "direct budget update",
    supabaseAdmin
      .from("kora_settings")
      .update({ data: { reservedEur: 0 } })
      .eq("workspace_id", "kora")
      .abortSignal(AbortSignal.timeout(10_000)),
  );
  const nullFinish = await supabaseAdmin
    .rpc("kora_paid_finish" as never, { p_id: id, p_lines: [], p_status: null } as never)
    .abortSignal(AbortSignal.timeout(10_000));
  assert.equal(nullFinish.error?.code, "P0001", "NULL settlement rejected through HTTP");
  assert.deepEqual(await repo.paidAttempts.get(id), beforeProtection.attempt);
  assert.deepEqual(await repo.getSettings(), beforeProtection.settings);
  assert.deepEqual(await repo.usage.list(), beforeProtection.usage);
  assert.equal((await repo.idempotency.get(protectedHttpId))?.state, "pending");
  console.log(JSON.stringify({ event: "a433.http.protected_writes.pass", statePreserved: true }));

  // SQL must reject fractional-cent reservations even from a direct service_role RPC.
  const fractional = await supabaseAdmin.rpc(
    "kora_paid_reserve" as never,
    {
      p_attempt: {
        id: repo.nextId("pat"),
        workspaceId: "kora",
        month: now.toISOString().slice(0, 7),
        kind,
        estimateEur: 0.02001,
        units: 1,
        label: "fractional-cent SQL attempt",
        createdAt: now.toISOString(),
      },
    } as never,
  );
  assert.ok(fractional.error, "SQL accepted a reserve with five decimal places");
  assert.equal((await repo.getSettings()).reservedEur, 0.02);

  // service_role may not perform administrator-only reconciliation.
  const denied = await supabaseAdmin.rpc(
    "kora_paid_reconcile" as never,
    { p_id: id, p_resolution: "not_billed", p_billed_eur: 0, p_evidence: {} } as never,
  );
  assert.ok(denied.error, "HTTP service_role unexpectedly allowed reconciliation");

  // Two concurrent reservations: spent .015 + held .02 leaves .015 of .05 budget.
  const base = {
    workspaceId: "kora",
    month: now.toISOString().slice(0, 7),
    kind,
    estimateEur: 0.01,
    units: 1,
    label: "A3 concurrency",
    createdAt: now.toISOString(),
  };
  const a = repo.nextId("pat"),
    b = repo.nextId("pat");
  const results = await Promise.all([
    repo.paidAttempts.reserve({ ...base, id: a }),
    repo.paidAttempts.reserve({ ...base, id: b }),
  ]);
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal((await repo.getSettings()).reservedEur, 0.03);
  await repo.paidAttempts.finish(results[0]!.ok ? a : b, [], "not_sent");
  assert.equal((await repo.getSettings()).reservedEur, 0.02);
  assert.equal((await repo.usage.list()).length, 1);
  // A3.1: unique durable HTTP claim; concurrency and replay go through PostgREST.
  const httpId = "a".repeat(64);
  const scope = {
    id: httpId,
    workspaceId: "kora",
    actorId: "a3-ci-operator",
    route: "POST /articles",
    fingerprint: "b".repeat(64),
  };
  const claims = await Promise.all([repo.idempotency.begin(scope), repo.idempotency.begin(scope)]);
  assert.equal(claims.filter((c) => c.kind === "claimed").length, 1);
  assert.equal(claims.filter((c) => c.kind === "pending").length, 1);
  assert.deepEqual(await repo.idempotency.begin({ ...scope, fingerprint: "c".repeat(64) }), {
    kind: "conflict",
  });
  await repo.idempotency.complete(httpId, 201, '{"id":"article-test"}');
  assert.deepEqual(await repo.idempotency.begin(scope), {
    kind: "completed",
    status: 201,
    bodyText: '{"id":"article-test"}',
  });
  await repo.idempotency.complete(httpId, 201, '{"id":"article-test"}');
  await assert.rejects(repo.idempotency.uncertain(httpId));
  const uncertainId = "d".repeat(64);
  const pending = { ...scope, id: uncertainId };
  assert.deepEqual(await repo.idempotency.begin(pending), { kind: "claimed" });
  await repo.idempotency.uncertain(uncertainId);
  assert.deepEqual(await repo.idempotency.begin(pending), { kind: "uncertain" });
  await assert.rejects(repo.idempotency.complete(uncertainId, 201, "{}"));

  // A4 characterization: two independent repositories and actual PostgREST/PostgreSQL.
  // The clock is injected only in this test process; no production database is used.
  const lockKey = "a4-test-expiry-overlap";
  const secondRepo = new DbRepository();
  const clockBase = Date.now();
  let clockNow = clockBase;
  setClock(() => new Date(clockNow));
  try {
    const firstToken = await repo.acquireLock(lockKey, 1000);
    assert.ok(firstToken);
    assert.equal(await secondRepo.acquireLock(lockKey, 1000), null);
    clockNow += 1001;
    const secondToken = await secondRepo.acquireLock(lockKey, 1000);
    assert.ok(secondToken, "Expired lock should be reacquired in baseline");
    await repo.releaseLock(lockKey, firstToken);
    assert.equal(await repo.acquireLock(lockKey, 1000), null, "Stale token released new lock");
    await secondRepo.releaseLock(lockKey, secondToken);
    console.log(
      JSON.stringify({
        event: "a4.db.lock_expiry.characterized",
        reacquiredAfterExpiry: true,
        staleReleasePreservedNewLock: true,
      }),
    );
  } finally {
    setClock(null);
  }
  console.log(
    JSON.stringify({
      event: "a3.db_repository.integration_pass",
      settledCostEur: 0.015,
      overrunCostEur: 0.03,
      retainedReserveEur: 0.02,
      concurrentReservationsAccepted: 1,
      reconciliationViaHttpDenied: true,
    }),
  );
}
await main();
