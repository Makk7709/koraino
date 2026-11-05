/** Test-only HTTP host for the real KORA router; never imported by the app. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { setAuthModeForTests } from "../../../src/server/auth/mode";
import { setAdapters } from "../../../src/server/adapters";
import { handleApiRequest } from "../../../src/server/router";

assert.equal(process.env["A3_DB_ISOLATED_TEST"], "1");
assert.ok(!process.env["VITEST"]);
const db = new URL(process.env["SUPABASE_URL"]!);

for (const url of [db]) {
  assert.equal(url.protocol, "http:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.ok(url.port && !["54321", "55321"].includes(url.port));
}
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const target = new URL(input instanceof Request ? input.url : String(input));
  assert.ok([db.origin].includes(target.origin), "External network denied");
  if (target.origin === db.origin) {
    assert.ok(target.pathname.startsWith("/rest/v1/"));
    target.pathname = target.pathname.slice("/rest/v1".length);
  }
  const options = {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(10_000),
  };
  return nativeFetch(input instanceof Request ? new Request(target, input) : target, options);
};
// Identity is a deterministic fixture; this suite tests persistence/HTTP, not Supabase Auth.
setAuthModeForTests("demo");
setAdapters({ ai: null });
const server = createServer((req, res) => {
  void (async () => {
    assert.ok(req.url?.startsWith("/api/newsletters"));
    assert.ok(["GET", "PATCH", "POST", "DELETE"].includes(req.method ?? ""));
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      assert.ok(size <= 65536);
      chunks.push(buffer);
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers.set(name, value);
    }
    const response = await handleApiRequest(
      new Request("http://127.0.0.1" + req.url, {
        method: req.method!,
        headers,
        ...(chunks.length ? { body: Buffer.concat(chunks).toString("utf8") } : {}),
      }),
    );
    const body = await response.text();
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    res.end(body);
  })().catch((error: unknown) => {
    console.error(error);
    res.destroy();
  });
});
server.requestTimeout = 15_000;
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  assert.ok(address && typeof address === "object");
  console.log(
    JSON.stringify({
      event: "newsletter.http.ready",
      port: address.port,
      pid: process.pid,
    }),
  );
});
