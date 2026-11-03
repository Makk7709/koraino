import { afterEach, describe, expect, it, vi } from "vitest";
import { adapters } from "@/server/adapters";
import { setClock } from "@/server/clock";
import { GENERATION_LOCK_TTL_MS } from "@/server/services/locks";
import type { PaidAttemptInput } from "@/server/store/paid-attempts";
import { call, NOW, setup, teardown, USERS } from "./helpers";

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const post = (key: string) =>
  call<{ error: { code: string } }>("POST", "/articles", {
    user: USERS.redacteur,
    body: { signalId: "sig_verkor" },
    headers: { "idempotency-key": key },
  });
afterEach(() => {
  vi.restoreAllMocks();
  teardown();
});

describe("A4 durable article generation", () => {
  it("keeps one provider call and one article after lock expiry with two HTTP keys", async () => {
    const repo = setup();
    const started = gate();
    const release = gate();
    const model = adapters().textModel;
    const generate = model.generateDossier.bind(model);
    const provider = vi.fn(async (input, base) => {
      started.resolve();
      await release.promise;
      return base;
    });
    // Only enhanceDossier is used by this route.
    adapters().ai = { enhanceDossier: provider } as unknown as NonNullable<
      ReturnType<typeof adapters>["ai"]
    >;
    vi.spyOn(model, "generateDossier").mockImplementation(generate);
    const first = post("a4-unit-first-key-000001");
    try {
      await started.promise;
      setClock(() => new Date(NOW.getTime() + GENERATION_LOCK_TTL_MS + 1));
      const second = await post("a4-unit-second-key-00002");
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe("generation_unresolved");
      expect(provider).toHaveBeenCalledTimes(1);
    } finally {
      release.resolve();
    }
    expect((await first).status).toBe(201);
    const articles = (await repo.articles.list()).filter((a) => a.signalId === "sig_verkor");
    expect(articles).toHaveLength(1);
    expect((await repo.signals.get("sig_verkor"))?.articleId).toBe(articles[0]!.id);
  });

  it("retains ownership and reserve after an ambiguous provider failure", async () => {
    const repo = setup();
    const before = (await repo.getSettings()).reservedEur;
    const provider = vi.spyOn(adapters().textModel, "generateDossier").mockImplementation(() => {
      throw new Error("lost response");
    });
    expect((await post("a4-unit-failure-key-0001")).status).toBe(500);
    const retry = await post("a4-unit-failure-key-0002");
    expect(retry.status).toBe(409);
    expect(retry.body.error.code).toBe("generation_unresolved");
    expect(provider).toHaveBeenCalledTimes(1);
    expect((await repo.getSettings()).reservedEur).toBeGreaterThan(before);
    expect((await repo.articles.list()).filter((a) => a.signalId === "sig_verkor")).toHaveLength(0);
  });

  it("does not overwrite a signal changed while the provider is working", async () => {
    const repo = setup();
    const generate = adapters().textModel.generateDossier.bind(adapters().textModel);
    adapters().ai = {
      enhanceDossier: async (_input: unknown, base: ReturnType<typeof generate>) => {
        const signal = (await repo.signals.get("sig_verkor"))!;
        await repo.signals.update({ ...signal, title: "Concurrent edit" });
        return base;
      },
    } as unknown as NonNullable<ReturnType<typeof adapters>["ai"]>;
    expect((await post("a4-unit-edit-key-0000001")).status).toBe(500);
    expect((await repo.signals.get("sig_verkor"))?.title).toBe("Concurrent edit");
    expect((await repo.articles.list()).filter((a) => a.signalId === "sig_verkor")).toHaveLength(0);
    expect((await post("a4-unit-edit-key-0000002")).status).toBe(409);
  });

  it("rejects stale tokens and replays completion without overwriting a later article edit", async () => {
    const repo = setup();
    const signal = (await repo.signals.get("sig_verkor"))!;
    const complete = vi.spyOn(repo.articleGenerations, "complete");
    expect((await post("a4-unit-complete-key-001")).status).toBe(201);
    const [id, token, article] = complete.mock.calls[0]!;
    await expect(
      repo.articleGenerations.complete(id, crypto.randomUUID(), article),
    ).rejects.toThrow("ownership");
    await repo.articles.update({ ...article, title: "Editor title" });
    await repo.articleGenerations.complete(id, token, article);
    await repo.articleGenerations.uncertain(id, token);
    expect((await repo.articles.get(article.id))?.title).toBe("Editor title");
    await expect(repo.signals.update(signal)).rejects.toThrow("immutable");
    await expect(repo.articles.insert({ ...article, id: "duplicate" })).rejects.toThrow(
      "already exists",
    );
    await expect(
      repo.articleGenerations.complete(id, token, { ...article, title: "Changed replay" }),
    ).rejects.toThrow("replay");
  });

  it("reserves only once under direct concurrent claims and does not claim on budget denial", async () => {
    const repo = setup();
    const signal = (await repo.signals.get("sig_verkor"))!;
    const input: PaidAttemptInput = {
      id: "a4-attempt-001",
      workspaceId: repo.workspaceId,
      month: "2026-10",
      kind: "generation_article",
      estimateEur: 100000,
      units: 1,
      label: "A4",
      createdAt: NOW.toISOString(),
    };
    const claim = { signal, token: crypto.randomUUID() };
    expect(await repo.articleGenerations.reserve(claim, input)).toMatchObject({ ok: false });
    const settings = await repo.getSettings();
    await repo.saveSettings({ ...settings, paidCallsSuspended: false, suspendedMonth: null });
    const results = await Promise.all(
      [1, 2].map((i) =>
        repo.articleGenerations.reserve(
          { ...claim, token: crypto.randomUUID() },
          { ...input, id: "a4-attempt-00" + i, estimateEur: 0.01 },
        ),
      ),
    );
    expect(results).toEqual([{ ok: true }, { blocked: "busy" }]);
    expect((await repo.getSettings()).reservedEur).toBeCloseTo(0.01);
  });
});
