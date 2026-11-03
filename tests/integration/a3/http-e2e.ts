/** HTTP system tests: real sockets, separate KORA processes and disposable PostgreSQL. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer, request, type Server } from "node:http";
import { createServer as createTcpServer, type Server as TcpServer } from "node:net";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { DbRepository } from "../../../src/server/store/db";
import { supabaseAdmin } from "../../../src/integrations/supabase/client.server";
import { buildSeed, DEFAULT_USER_ID } from "../../../src/server/store/seed";

assert.equal(process.env["A3_DB_ISOLATED_TEST"], "1");
assert.ok(!process.env["VITEST"]);
const db = new URL(process.env["SUPABASE_URL"]!);
assert.equal(db.protocol, "http:");
assert.equal(db.hostname, "127.0.0.1");
assert.ok(db.port && !["54321", "55321"].includes(db.port));
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const target = new URL(input instanceof Request ? input.url : String(input));
  assert.equal(target.origin, db.origin, "External database request denied");
  assert.ok(target.pathname.startsWith("/rest/v1/"));
  target.pathname = target.pathname.slice("/rest/v1".length);
  return nativeFetch(input instanceof Request ? new Request(target, input) : target, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(10_000),
  });
};
const repo = new DbRepository();
const fixture = fileURLToPath(new URL("./http-fixture.ts", import.meta.url));
let child: ChildProcess | undefined;
const servers: (Server | TcpServer)[] = [];
let invocations = 0;
let upstream = "";
let lost: { status: number; text: string } | undefined;

async function listen(server: Server | TcpServer): Promise<string> {
  servers.push(server);
  if ("requestTimeout" in server) server.requestTimeout = 15_000;
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return "http://127.0.0.1:" + address.port;
}
async function stop(): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await Promise.race([
    exited,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error("Child shutdown timeout")), 5000);
      timer.unref();
    }),
  ]);
}
async function start(provider: string): Promise<number> {
  child = spawn(process.execPath, ["--no-env-file", fixture], {
    env: { ...process.env, A3_FAKE_PROVIDER: provider },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const current = child;
  const ready = z.object({
    event: z.literal("a3.http.ready"),
    port: z.number().int().min(1024).max(65535),
    pid: z.number().int().positive(),
  });
  return new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("KORA startup timeout")), 15_000);
    let output = "";
    current.once("error", reject);
    current.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("KORA exited before readiness"));
    });
    current.stdout!.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      let end: number;
      while ((end = output.indexOf("\n")) >= 0) {
        const line = output.slice(0, end);
        output = output.slice(end + 1);
        if (!line.startsWith("{")) continue;
        const parsed = ready.safeParse(JSON.parse(line));
        if (!parsed.success) continue;
        clearTimeout(timer);
        upstream = "http://127.0.0.1:" + parsed.data.port;
        resolve(parsed.data.pid);
      }
    });
  });
}
function post(url: string, signalId: string, key: string): Promise<Response> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ signalId });
    const req = request(
      url + "/api/articles",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          "x-kora-request": "1",
          "idempotency-key": key,
        },
        signal: AbortSignal.timeout(15_000),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.once("error", reject);
        res.once("end", () => {
          const headers = new Headers();
          for (const [name, value] of Object.entries(res.headers)) {
            if (typeof value === "string") headers.set(name, value);
          }
          resolve(
            new Response(Buffer.concat(chunks).toString("utf8"), {
              status: res.statusCode ?? 500,
              headers,
            }),
          );
        });
      },
    );
    req.once("error", reject);
    req.end(body);
  });
}
async function snapshot(key: string) {
  const id = createHash("sha256")
    .update([repo.workspaceId, DEFAULT_USER_ID, key].join("\u0000"))
    .digest("hex");
  return {
    operation: await repo.idempotency.get(id),
    usage: await repo.usage.list(),
    articles: await repo.articles.list(),
    settings: await repo.getSettings(),
  };
}
try {
  await repo.ensureReady();
  const seed = buildSeed(new Date());
  const user = seed.users.find((u) => u.id === DEFAULT_USER_ID);
  assert.ok(user);
  await repo.users.insert(user);
  const signals = seed.signals.filter((s) => !s.articleId && s.status !== "rejete").slice(0, 3);
  assert.equal(signals.length, 3);
  for (const signal of signals) await repo.signals.insert(signal);
  // Fresh disposable fixture only, after the financial integration assertions.
  const settings = await repo.getSettings();
  assert.equal(settings.reservedEur, 0);
  await repo.saveSettings({
    ...settings,
    quotaLimits: { ...settings.quotaLimits, api_budget_eur: 10 },
  });
  const before = await snapshot("a3-e2e-baseline-00000000");
  const provider = await listen(
    createServer((req, res) => {
      assert.equal(req.method, "POST");
      assert.equal(req.url, "/");
      invocations += 1;
      req.resume();
      res.writeHead(204);
      res.end();
    }),
  );
  const proxy = await listen(
    createTcpServer((socket) => {
      socket.setTimeout(15_000, () => socket.destroy());
      let received = Buffer.alloc(0);
      let handled = false;
      socket.on("data", (chunk: Buffer) => {
        if (handled) return;
        received = Buffer.concat([received, chunk]);
        if (received.length > 8192) {
          socket.destroy();
          return;
        }
        const split = received.indexOf("\r\n\r\n");
        if (split < 0) return;
        const headers = received.subarray(0, split).toString("utf8");
        const length = Number(/content-length:\s*(\d+)/i.exec(headers)?.[1]);
        if (!Number.isInteger(length) || length < 1 || length > 4096) {
          socket.destroy();
          return;
        }
        if (received.length < split + 4 + length) return;
        handled = true;
        void (async () => {
          const key = /idempotency-key:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim();
          assert.ok(key);
          const response = await nativeFetch(upstream + "/api/articles", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-kora-request": "1",
              "idempotency-key": key,
            },
            body: received.subarray(split + 4, split + 4 + length).toString("utf8"),
            signal: AbortSignal.timeout(15_000),
          });
          lost = { status: response.status, text: await response.text() };
          // Raw TCP disconnect: Bun's HTTP res.destroy() can synthesize an HTTP error.
          // The upstream router has completed; zero HTTP response bytes reach the client.
          socket.destroy();
        })().catch((error: unknown) => {
          console.error(error);
          socket.destroy();
        });
      });
      socket.on("error", () => {});
    }),
  );
  const firstPid = await start(provider);
  const key1 = "a3-e2e-lost-response-000001";
  await assert.rejects(post(proxy, signals[0]!.id, key1), "Client must observe lost response");
  assert.equal(lost?.status, 201, lost?.text);
  assert.ok(lost);
  assert.equal(invocations, 1);
  const committed = await snapshot(key1);
  assert.equal(committed.operation?.state, "completed");
  assert.equal(committed.operation.bodyText, lost.text);
  const replay = await post(upstream, signals[0]!.id, key1);
  assert.equal(replay.status, 201);
  assert.equal(replay.headers.get("x-kora-idempotency"), "replayed");
  assert.equal(await replay.text(), lost.text);
  assert.equal(invocations, 1);
  assert.deepEqual(await snapshot(key1), committed);
  console.log(
    JSON.stringify({
      event: "a3.e2e.lost_response.pass",
      providerInvocations: 1,
    }),
  );

  const key2 = "a3-e2e-restart-server-00002";
  const original = await post(upstream, signals[1]!.id, key2);
  const originalText = await original.text();
  assert.equal(original.status, 201, originalText);
  assert.equal(invocations, 2);
  const persisted = await snapshot(key2);
  assert.equal(persisted.operation?.state, "completed");
  await stop();
  const secondPid = await start(provider);
  assert.notEqual(secondPid, firstPid, "A new OS process must serve the retry");
  const afterRestart = await post(upstream, signals[1]!.id, key2);
  assert.equal(afterRestart.status, 201);
  assert.equal(afterRestart.headers.get("x-kora-idempotency"), "replayed");
  assert.equal(await afterRestart.text(), originalText);
  assert.equal(invocations, 2);
  assert.deepEqual(await snapshot(key2), persisted);
  assert.equal(persisted.usage.length, before.usage.length + 2);
  assert.equal(persisted.articles.length, before.articles.length + 2);
  assert.equal(persisted.settings.reservedEur, 0);
  console.log(
    JSON.stringify({
      event: "a3.e2e.restart.pass",
      distinctServerProcesses: true,
      totalProviderInvocations: 2,
      newUsageRows: 2,
      newArticles: 2,
      retainedReserveEur: 0,
    }),
  );

  // A4: process dies while the instrumented provider is still processing.
  let reportProviderStart!: () => void;
  const providerStarted = new Promise<void>((resolve) => {
    reportProviderStart = resolve;
  });
  const heldProvider = await listen(
    createServer((req, res) => {
      assert.equal(req.method, "POST");
      invocations += 1;
      req.resume();
      reportProviderStart();
      // Deliberately retain the response until the KORA process is killed.
      res.on("error", () => {});
    }),
  );
  await stop();
  await start(heldProvider);
  const crashKey = "a4-e2e-crash-during-call-001";
  const pendingRequest = post(upstream, signals[2]!.id, crashKey).then(
    () => "response",
    () => "connection_lost",
  );
  await Promise.race([
    providerStarted,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Provider not reached")), 4000),
    ),
  ]);
  const beforeCrash = await snapshot(crashKey);
  assert.equal(beforeCrash.operation?.state, "pending");
  assert.ok(beforeCrash.settings.reservedEur > 0, "Expected reservation before crash");
  assert.equal(invocations, 3);
  await stop();
  assert.equal(await pendingRequest, "connection_lost");
  const afterCrash = await snapshot(crashKey);
  assert.equal(afterCrash.operation?.state, "pending");
  assert.equal(afterCrash.settings.reservedEur, beforeCrash.settings.reservedEur);
  await start(heldProvider);
  const retryAfterCrash = await post(upstream, signals[2]!.id, crashKey);
  assert.equal(retryAfterCrash.status, 409);
  assert.equal(invocations, 3, "Same-key retry triggered another provider invocation");
  const afterRetry = await snapshot(crashKey);
  assert.equal(afterRetry.operation?.state, "pending");
  assert.equal(afterRetry.settings.reservedEur, beforeCrash.settings.reservedEur);
  // A new HTTP key cannot bypass the durable signal claim after process death and TTL expiry.
  const crashedLock = await supabaseAdmin
    .from("kora_records")
    .delete()
    .eq("collection", "locks")
    .eq("id", "article-create:" + signals[2]!.id);
  assert.equal(crashedLock.error, null);
  const differentKeyAfterCrash = await post(upstream, signals[2]!.id, "a4-e2e-crash-different-key");
  assert.equal(differentKeyAfterCrash.status, 409);
  assert.equal((await differentKeyAfterCrash.json()).error.code, "generation_unresolved");
  assert.equal(invocations, 3);
  assert.equal((await repo.getSettings()).reservedEur, beforeCrash.settings.reservedEur);
  console.log(
    JSON.stringify({
      event: "a4.e2e.crash_during_call.pass",
      providerCalls: 1,
      sameKeyRetryStatus: retryAfterCrash.status,
      differentKeyRetryStatus: differentKeyAfterCrash.status,
      operationState: afterRetry.operation?.state,
      reservationRetained: true,
    }),
  );

  // Regression: two different HTTP keys after expiry must produce only one paid result.
  const raceSignal = { ...signals[0]!, id: "a4-signal-expiry-race" };
  await repo.signals.insert(raceSignal);
  let calls = 0;
  let startedFirst!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    startedFirst = resolve;
  });
  const waitingResponses: import("node:http").ServerResponse[] = [];
  const raceProvider = await listen(
    createServer((req, res) => {
      req.resume();
      calls += 1;
      waitingResponses.push(res);
      if (calls === 1) startedFirst();
    }),
  );
  await stop();
  await start(raceProvider);
  const firstRace = post(upstream, raceSignal.id, "a4-race-first-key-00000001");
  await Promise.race([
    firstStarted,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("First provider call timeout")), 4000),
    ),
  ]);
  // Fixture-only forced expiry on the disposable database, while first call is held.
  const lockId = "article-create:" + raceSignal.id;
  const lockRead = await supabaseAdmin
    .from("kora_records")
    .select("data")
    .eq("collection", "locks")
    .eq("id", lockId)
    .single();
  assert.equal(lockRead.error, null);
  assert.ok(lockRead.data);
  const lock = lockRead.data.data as { id: string; token: string; expiresAt: string };
  assert.ok(lock.token && lock.expiresAt);
  const lockUpdate = await supabaseAdmin
    .from("kora_records")
    .update({ data: { ...lock, expiresAt: "2000-01-01T00:00:00.000Z" } as never })
    .eq("collection", "locks")
    .eq("id", lockId)
    .eq("data->>token", lock.token)
    .select("id");
  assert.equal(lockUpdate.error, null);
  assert.equal(lockUpdate.data?.length, 1);
  const secondRace = await post(upstream, raceSignal.id, "a4-race-second-key-0000002");
  assert.equal(secondRace.status, 409);
  assert.equal((await secondRace.json()).error.code, "generation_unresolved");
  assert.equal(calls, 1);
  for (const response of waitingResponses) {
    response.writeHead(204);
    response.end();
  }
  const firstResponse = await firstRace;
  assert.equal(firstResponse.status, 201, await firstResponse.text());
  const raceArticles = (await repo.articles.list()).filter(
    (article) => article.signalId === raceSignal.id,
  );
  assert.equal(raceArticles.length, 1);
  assert.equal((await repo.signals.get(raceSignal.id))?.articleId, raceArticles[0]!.id);
  assert.equal(calls, 1);
  console.log(
    JSON.stringify({
      event: "a4.e2e.expired_lock_two_keys.pass",
      providerCalls: calls,
      statuses: [firstResponse.status, secondRace.status],
      articles: raceArticles.length,
    }),
  );
} catch (error: unknown) {
  console.error(error);
  throw error;
} finally {
  await stop();
  for (const server of servers) {
    if ("closeAllConnections" in server) server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => {
        if (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING")
          reject(error);
        else resolve();
      }),
    );
  }
}
