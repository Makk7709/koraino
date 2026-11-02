/** HTTP system tests: real sockets, separate KORA processes and disposable PostgreSQL. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { DbRepository } from "../../../src/server/store/db";
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
const servers: Server[] = [];
let invocations = 0;
let upstream = "";
let dropNext = true;
let lost: { status: number; text: string } | undefined;

async function listen(server: Server): Promise<string> {
  servers.push(server);
  server.requestTimeout = 15_000;
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
  return nativeFetch(url + "/api/articles", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-kora-request": "1",
      "idempotency-key": key,
    },
    body: JSON.stringify({ signalId }),
    signal: AbortSignal.timeout(15_000),
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
  const signals = seed.signals.filter((s) => !s.articleId && s.status !== "rejete").slice(0, 2);
  assert.equal(signals.length, 2);
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
    createServer((req, res) => {
      void (async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const response = await nativeFetch(upstream + "/api/articles", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-kora-request": "1",
            "idempotency-key": String(req.headers["idempotency-key"]),
          },
          body: Buffer.concat(chunks).toString("utf8"),
          signal: AbortSignal.timeout(15_000),
        });
        const text = await response.text();
        if (dropNext) {
          dropNext = false;
          lost = { status: response.status, text };
          // Full upstream response implies the router's durable completion has returned.
          // Destroy before sending any response bytes to the client.
          res.destroy();
          return;
        }
        res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
        res.end(text);
      })().catch((error: unknown) => {
        console.error(error);
        res.destroy();
      });
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
  const replay = await post(proxy, signals[0]!.id, key1);
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
  const original = await post(proxy, signals[1]!.id, key2);
  const originalText = await original.text();
  assert.equal(original.status, 201, originalText);
  assert.equal(invocations, 2);
  const persisted = await snapshot(key2);
  assert.equal(persisted.operation?.state, "completed");
  await stop();
  const secondPid = await start(provider);
  assert.notEqual(secondPid, firstPid, "A new OS process must serve the retry");
  const afterRestart = await post(proxy, signals[1]!.id, key2);
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
} catch (error: unknown) {
  console.error(error);
  throw error;
} finally {
  await stop();
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => {
        if (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING")
          reject(error);
        else resolve();
      }),
    );
  }
}
