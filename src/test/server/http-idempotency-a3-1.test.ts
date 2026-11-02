import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { call, setup, teardown } from "./helpers";
import { getRepository } from "@/server/store/memory";

const key = "test-operation-identifier-00000001";
beforeEach(() => setup());
afterEach(teardown);

describe("A3.1 — HTTP idempotency on paid generation", () => {
  it("replays an identical successful request without a second charge", async () => {
    const repo = await getRepository();
    const source = (await repo.signals.list()).find((s) => !s.articleId && s.status !== "rejete");
    expect(source).toBeDefined();
    const body = { signalId: source!.id };
    const before = (await repo.usage.list()).length;
    const first = await call("POST", "/articles", { body, headers: { "Idempotency-Key": key } });
    expect(first.status).toBe(201);
    const second = await call("POST", "/articles", { body, headers: { "Idempotency-Key": key } });
    expect(second.status).toBe(201);
    expect(second.headers.get("x-kora-idempotency")).toBe("replayed");
    expect(second.body).toEqual(first.body);
    expect((await repo.usage.list()).length).toBe(before + 1);
  });

  it("rejects a reused key for a different payload", async () => {
    const repo = await getRepository();
    const ids = (await repo.signals.list()).filter((s) => !s.articleId && s.status !== "rejete").slice(0, 2);
    expect(ids).toHaveLength(2);
    const first = await call("POST", "/articles", {
      body: { signalId: ids[0]!.id }, headers: { "Idempotency-Key": key },
    });
    expect(first.status).toBe(201);
    const second = await call("POST", "/articles", {
      body: { signalId: ids[1]!.id }, headers: { "Idempotency-Key": key },
    });
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ error: { code: "idempotency_key_reused" } });
  });

  it("refuses to retry an uncertain operation", async () => {
    const repo = await getRepository();
    const source = (await repo.signals.list()).find((s) => !s.articleId && s.status !== "rejete");
    expect(source).toBeDefined();
    const original = repo.idempotency.complete;
    repo.idempotency.complete = async () => { throw new Error("lost database acknowledgement"); };
    const body = { signalId: source!.id };
    try {
      const first = await call("POST", "/articles", {
        body, headers: { "Idempotency-Key": key },
      });
      expect(first.status).toBe(500);
    } finally {
      repo.idempotency.complete = original;
    }
    const again = await call("POST", "/articles", { body, headers: { "Idempotency-Key": key } });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ error: { code: "idempotency_uncertain" } });
  });
});
