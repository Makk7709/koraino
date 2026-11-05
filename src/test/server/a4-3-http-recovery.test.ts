import { afterEach, describe, expect, it, vi } from "vitest";
import { adapters } from "@/server/adapters";
import { call, setup, teardown, USERS } from "./helpers";

afterEach(() => {
  vi.restoreAllMocks();
  teardown();
});

describe("A4.3 — HTTP recovery handling", () => {
  it("returns the stored article after a DBA-verified completed generation, without paid work", async () => {
    const repo = setup();
    const initial = await call<{ id: string }>("POST", "/articles", {
      user: USERS.redacteur,
      body: { signalId: "sig_verkor" },
      headers: { "idempotency-key": "a43-http-before-recovery" },
    });
    expect(initial.status).toBe(201);
    const existingId = initial.body.id;
    expect((await repo.articles.get(existingId))?.signalId).toBe("sig_verkor");
    const provider = vi.spyOn(adapters().textModel, "generateDossier");
    vi.spyOn(repo.idempotency, "begin").mockResolvedValue({
      kind: "recovered_completed",
      articleId: existingId,
    });

    const replay = await call<{ id: string }>("POST", "/articles", {
      user: USERS.redacteur,
      body: { signalId: "sig_verkor" },
      headers: { "idempotency-key": "a43-http-before-recovery" },
    });

    expect(replay.status).toBe(201);
    expect(replay.headers.get("x-kora-idempotency")).toBe("recovered");
    expect(replay.body.id).toBe(existingId);
    expect(provider).not.toHaveBeenCalled();
    expect((await repo.articles.list()).filter((a) => a.signalId === "sig_verkor")).toHaveLength(1);
  });

  it("blocks an original intent that the DBA explicitly closed as not sent", async () => {
    const repo = setup();
    const provider = vi.spyOn(adapters().textModel, "generateDossier");
    vi.spyOn(repo.idempotency, "begin").mockResolvedValue({ kind: "closed_not_sent" });

    const response = await call<{ error: { code: string } }>("POST", "/articles", {
      user: USERS.redacteur,
      body: { signalId: "sig_verkor" },
      headers: { "idempotency-key": "a43-http-closed-not-sent" },
    });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("idempotency_closed_not_sent");
    expect(provider).not.toHaveBeenCalled();
    expect((await repo.articles.list()).filter((a) => a.signalId === "sig_verkor")).toHaveLength(0);
  });
});
