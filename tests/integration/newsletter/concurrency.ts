/** P0-01: two real KORA processes, PostgREST and PostgreSQL. No external providers. */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { z } from "zod";
import { buildSeed } from "../../../src/server/store/seed";
import { touchEdition } from "../../../src/server/services/newsletters";
import type { NewsletterRecord } from "../../../src/server/store/records";
import type { NewsletterMutation } from "../../../src/server/store/newsletter-mutations";

assert.equal(process.env["A3_DB_ISOLATED_TEST"], "1");
const pgUrl = new URL(process.env["NL_TEST_PG_URL"]!);
const apiUrl = new URL(process.env["SUPABASE_URL"]!);
for (const u of [pgUrl, apiUrl]) {
  assert.equal(u.hostname, "127.0.0.1");
  assert.ok(u.port && !["5432", "54321", "55321"].includes(u.port));
}
assert.equal(pgUrl.pathname, "/kora_a3_ci");
const sql = postgres(pgUrl.href, { max: 6, connect_timeout: 5, idle_timeout: 5 });
// postgres.js serializes jsonb parameters itself. Passing a JSON string would
// persist a JSON scalar instead of the record object expected by the repository.
const jsonb = (value: object) => sql.json(JSON.parse(JSON.stringify(value)) as postgres.JSONValue);
const children: ChildProcess[] = [];
const at = new Date().toISOString();
let seq = 0;
const id = (prefix: string) => `${prefix}_nl_ci_${++seq}`;
const report = (scenario: string) =>
  console.info(JSON.stringify({ event: "newsletter.integration.pass", scenario }));
const expected = (e: NewsletterRecord) => ({ version: e.version, revision: e.revision ?? 0 });

async function start(): Promise<{ origin: string; pid: number }> {
  const child = spawn(
    process.execPath,
    ["--no-env-file", fileURLToPath(new URL("./http-fixture.ts", import.meta.url))],
    {
      env: process.env,
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  children.push(child);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Newsletter server startup timeout")), 15_000);
    const ready = z.object({
      event: z.literal("newsletter.http.ready"),
      port: z.number().int().positive(),
      pid: z.number().int().positive(),
    });
    let output = "";
    child.once("error", reject);
    child.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("Server exited"));
    });
    child.stdout!.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      let end: number;
      while ((end = output.indexOf("\n")) >= 0) {
        const line = output.slice(0, end);
        output = output.slice(end + 1);
        if (!line.startsWith("{")) continue;
        const parsed = ready.safeParse(JSON.parse(line));
        if (parsed.success) {
          clearTimeout(timer);
          resolve({ origin: `http://127.0.0.1:${parsed.data.port}`, pid: parsed.data.pid });
        }
      }
    });
  });
}
async function request(
  origin: string,
  edition: NewsletterRecord,
  method: string,
  suffix: string,
  body: object,
  actor = "u_sophie",
) {
  const response = await fetch(`${origin}/api/newsletters/${edition.id}${suffix}`, {
    method,
    signal: AbortSignal.timeout(25_000),
    headers: {
      "content-type": "application/json",
      "x-kora-request": "1",
      "idempotency-key": crypto.randomUUID(),
      cookie: `kora_uid=${actor}`,
    },
    body: JSON.stringify({ ...expected(edition), ...body }),
  });
  return { status: response.status, body: (await response.json()) as NewsletterRecord };
}
async function read(edition: NewsletterRecord): Promise<NewsletterRecord> {
  const rows =
    await sql`SELECT data FROM public.kora_records WHERE collection='newsletters' AND id=${edition.id}`;
  return rows[0]!["data"] as NewsletterRecord;
}
async function fixture(approved = false): Promise<NewsletterRecord> {
  const e: NewsletterRecord = {
    id: id("nl"),
    title: "Concurrency fixture",
    intro: "Initial",
    version: 1,
    revision: 0,
    status: approved ? "approuvee" : "composition",
    weekOf: at,
    scheduledFor: at,
    createdAt: at,
    updatedAt: at,
    createdBy: "CI",
    items: [
      {
        id: id("nli"),
        title: "Subject",
        summary: "Initial summary",
        signalId: null,
        articleId: null,
        order: 1,
      },
    ],
    approval: approved
      ? {
          id: id("apv"),
          version: 1,
          channel: "newsletter",
          approvedBy: "CI",
          approvedAt: at,
          scheduledAt: null,
          valid: true,
          invalidatedAt: null,
          invalidatedReason: null,
        }
      : null,
  };
  await sql`INSERT INTO public.kora_records(collection,id,data) VALUES ('newsletters',${e.id},${jsonb(e)})`;
  assert.deepEqual(await read(e), e, "Newsletter fixture must round-trip as a JSON object");
  return e;
}
function mutation(before: NewsletterRecord, intro: string): NewsletterMutation {
  return {
    before,
    after: touchEdition({ ...before, intro }, new Date()),
    publication: null,
    audit: {
      id: id("aud"),
      at,
      actor: "CI",
      action: "newsletter.update",
      entity: "newsletter",
      entityId: before.id,
      details: "CAS fixture",
    },
  };
}
async function rpc(m: NewsletterMutation) {
  return sql.begin(async (tx) => {
    await tx`SET LOCAL ROLE service_role`;
    return tx`SELECT public.kora_newsletter_commit(${jsonb(m)}::jsonb)`;
  });
}
try {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(apiUrl, { signal: AbortSignal.timeout(1000) });
      if (r.status < 500) break;
    } catch {
      /* bounded startup wait */
    }
    if (attempt >= 40) throw new Error("PostgREST startup timeout");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const seed = buildSeed(new Date());
  for (const user of seed.users)
    await sql`INSERT INTO public.kora_records(collection,id,data) VALUES ('users',${user.id},${jsonb(user)})`;
  const signals = seed.signals
    .slice(0, 2)
    .map((s, i) => ({ ...s, id: `nl_ci_signal_${i}`, articleId: null }));
  for (const signal of signals)
    await sql`INSERT INTO public.kora_records(collection,id,data) VALUES ('signals',${signal.id},${jsonb(signal)})`;
  const malformed = await sql`SELECT count(*)::integer AS n FROM public.kora_records
    WHERE collection IN ('users','signals') AND jsonb_typeof(data) <> 'object'`;
  assert.equal(malformed[0]!["n"], 0, "Fixture rows must contain JSON objects");
  const [a, b] = await Promise.all([start(), start()]);
  assert.notEqual(a.pid, b.pid);
  // Exercise first boot on the empty disposable workspace, rather than pre-seeding
  // settings and concealing a mismatch between the demo seed and the SQL contract.
  const bootstrap = await Promise.all(
    [a, b].map(async ({ origin }) => {
      const response = await fetch(`${origin}/api/newsletters`, {
        signal: AbortSignal.timeout(25_000),
      });
      assert.equal(response.status, 200, "Concurrent empty-workspace initialization");
    }),
  );
  assert.equal(bootstrap.length, 2);
  const settings = await sql`SELECT data FROM public.kora_settings WHERE workspace_id='kora'`;
  assert.equal(settings[0]!["data"].workspaceId, "kora");
  report("concurrent first boot uses SQL workspace identity");
  const origins = [a.origin, b.origin];
  for (const scenario of ["two edits", "edit versus approval", "two approvals"] as const) {
    const e = await fixture();
    const responses = await Promise.all(
      origins.map((origin, i) =>
        scenario === "two approvals" || (scenario === "edit versus approval" && i === 1)
          ? request(origin, e, "POST", "/approve", {}, i === 0 ? "u_sophie" : "u_claire")
          : request(
              origin,
              e,
              "PATCH",
              "",
              {
                items: [{ id: e.items[0]!.id, summary: `Writer ${i}`, order: 1 }],
              },
              i === 0 ? "u_lucas" : "u_sophie",
            ),
      ),
    );
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    const current = await read(e);
    assert.equal(current.revision, 1);
    assert.equal(
      current.items[0]!.summary,
      responses.find((r) => r.status === 200)!.body.items[0]!.summary,
    );
    if (current.approval?.valid) assert.equal(current.approval.version, current.version);
    report(scenario);
  }
  for (const scenario of ["two additions", "addition versus removal"] as const) {
    const e = await fixture();
    const responses = await Promise.all([
      request(a.origin, e, "POST", "/items", { signalId: signals[0]!.id }),
      scenario === "two additions"
        ? request(b.origin, e, "POST", "/items", { signalId: signals[1]!.id })
        : request(b.origin, e, "DELETE", `/items/${e.items[0]!.id}`, {}),
    ]);
    assert.deepEqual(
      responses.map((r) => r.status).sort(),
      [responses.find((r) => r.status < 300)!.status, 409].sort(),
    );
    const current = await read(e);
    assert.equal(current.revision, 1);
    const failed = responses.findIndex((r) => r.status === 409);
    const retry =
      scenario === "addition versus removal" && failed === 1
        ? await request(b.origin, current, "DELETE", `/items/${e.items[0]!.id}`, {})
        : await request(origins[failed]!, current, "POST", "/items", {
            signalId: signals[failed]!.id,
          });
    assert.ok([200, 201].includes(retry.status));
    assert.equal((await read(e)).items.length, scenario === "two additions" ? 3 : 1);
    report(scenario);
  }
  const approved = await fixture(true);
  const exports = await Promise.all(
    origins.map((origin, i) =>
      request(origin, approved, "POST", "/export", {}, i === 0 ? "u_sophie" : "u_claire"),
    ),
  );
  assert.deepEqual(
    exports.map((r) => r.status),
    [200, 200],
  );
  assert.deepEqual(exports[0]!.body, exports[1]!.body);
  assert.equal((await request(a.origin, approved, "POST", "/export", {})).status, 200);
  const count =
    await sql`SELECT count(*)::integer AS n FROM public.kora_records WHERE collection='publications' AND data->>'newsletterId'=${approved.id}`;
  assert.equal(count[0]!["n"], 1);
  const audits =
    await sql`SELECT count(*)::integer AS n FROM public.kora_records WHERE collection='audit' AND data->>'entityId'=${approved.id}`;
  assert.equal(audits[0]!["n"], 1);
  const publication =
    await sql`SELECT data FROM public.kora_records WHERE collection='publications' AND data->>'newsletterId'=${approved.id}`;
  const duplicate = { ...publication[0]!["data"], id: id("pub") };
  await assert.rejects(
    sql`INSERT INTO public.kora_records(collection,id,data) VALUES('publications',${duplicate.id},${sql.json(duplicate)})`,
    (err: unknown) => err instanceof Error && "code" in err && err.code === "23505",
  );
  report("double export, replay, one audit and durable uniqueness");

  const obsolete = await fixture(true);
  const changed = await request(a.origin, obsolete, "PATCH", "", { intro: "After approval" });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.approval?.valid, false);
  assert.equal((await request(b.origin, obsolete, "POST", "/export", {})).status, 409);
  report("obsolete approval cannot be exported");

  const rollback = await fixture(true);
  const m = mutation(rollback, rollback.intro);
  m.after = { ...rollback, status: "exportee", revision: 1 };
  m.publication = {
    ...publication[0]!["data"],
    id: id("pub"),
    newsletterId: rollback.id,
    version: rollback.version,
  };
  m.audit.action = "publication.success";
  await sql`INSERT INTO public.kora_records(collection,id,data) VALUES('audit',${m.audit.id},${jsonb(m.audit)})`;
  await assert.rejects(rpc(m));
  assert.deepEqual(await read(rollback), rollback);
  assert.equal(
    (
      await sql`SELECT count(*)::integer AS n FROM public.kora_records WHERE collection='publications' AND data->>'newsletterId'=${rollback.id}`
    )[0]!["n"],
    0,
  );
  report("audit failure rolls back export and edition");

  const crash = await fixture();
  const interrupted = mutation(crash, "Uncommitted edit");
  // Use a dedicated one-connection client: a reserved handle cannot reliably
  // execute COMMIT after its socket has been terminated by another session.
  const connection = postgres(pgUrl.href, { max: 1, connect_timeout: 5, idle_timeout: 5 });
  try {
    await connection`BEGIN`;
    const pid = (await connection`SELECT pg_backend_pid() AS pid`)[0]!["pid"] as number;
    await connection`SELECT public.kora_newsletter_commit(${jsonb(interrupted)}::jsonb)`;
    const termination = await sql`SELECT pg_terminate_backend(${pid}, 5000) AS terminated`;
    assert.equal(termination[0]!["terminated"], true);
  } finally {
    await connection.end({ timeout: 1 });
  }
  assert.deepEqual(await read(crash), crash);
  assert.equal(
    (
      await sql`SELECT count(*)::integer AS n FROM public.kora_records WHERE collection='audit' AND id=${interrupted.audit.id}`
    )[0]!["n"],
    0,
  );
  report("database connection crash rolls back entire transaction");

  const lease = await fixture();
  await sql`INSERT INTO public.kora_records(collection,id,data) VALUES('locks',${`newsletter-write:${lease.id}`},${sql.json({ id: `newsletter-write:${lease.id}`, token: "expired", expiresAt: "2000-01-01T00:00:00Z" })})`;
  await rpc(mutation(lease, "Successor"));
  await assert.rejects(
    rpc(mutation(lease, "Expired owner")),
    (err: unknown) => err instanceof Error && "code" in err && err.code === "PT409",
  );
  // Verify the PostgREST boundary itself: a stale revision must be a terminal
  // HTTP 409, not serialization_failure (40001), which PostgREST 14 retries.
  const staleRpc = await fetch(new URL("/rpc/kora_newsletter_commit", apiUrl), {
    method: "POST",
    signal: AbortSignal.timeout(5_000),
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env["SUPABASE_SERVICE_ROLE_KEY"]}`,
    },
    body: JSON.stringify({ p_input: mutation(lease, "Stale through PostgREST") }),
  });
  assert.equal(staleRpc.status, 409);
  const staleError = z.object({ code: z.literal("PT409") }).parse(await staleRpc.json());
  assert.equal(staleError.code, "PT409");
  assert.equal((await read(lease)).intro, "Successor");
  report("expired application lease does not bypass CAS; HTTP conflict is terminal");

  const merge = await fixture(true);
  const valid = mutation(merge, "Merge invalidates approval");
  await sql`SELECT public.kora_signal_mutations_commit(${jsonb([
    { collection: "newsletters", id: merge.id, before: merge, after: valid.after },
    { collection: "audit", id: valid.audit.id, before: null, after: valid.audit },
  ])}::jsonb)`;
  assert.equal((await read(merge)).approval?.valid, false);
  await assert.rejects(rpc(mutation(merge, "Stale writer after merge")));
  report("signal transaction shares newsletter invariants and CAS");

  await assert.rejects(
    sql.begin(async (tx) => {
      await tx`SET LOCAL ROLE service_role`;
      return tx`UPDATE public.kora_records SET data=data WHERE collection='newsletters' AND id=${lease.id}`;
    }),
    (err: unknown) => err instanceof Error && "code" in err && err.code === "42501",
  );
  const acl =
    await sql`SELECT has_function_privilege('anon','public.kora_newsletter_commit(jsonb)','EXECUTE') AS anon,
    has_function_privilege('authenticated','public.kora_newsletter_commit(jsonb)','EXECUTE') AS authenticated,
    has_function_privilege('service_role','public.kora_newsletter_commit(jsonb)','EXECUTE') AS service`;
  assert.deepEqual(acl[0], { anon: false, authenticated: false, service: true });
  report("direct writes and RPC ACL");
} finally {
  await Promise.all(
    children.map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
    }),
  );
  await sql.end({ timeout: 5 });
}
