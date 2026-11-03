import { afterEach, describe, expect, it, vi } from "vitest";
import { adapters } from "@/server/adapters";
import { call, setup, teardown } from "./helpers";

/**
 * A4.2 RED tests — read-only with respect to production.
 * These tests deliberately assert the desired rollback contract against the
 * pre-fix implementation. They are expected to fail until A4.2 is fixed.
 */
afterEach(() => {
  vi.restoreAllMocks();
  teardown();
});

describe("A4.2 — atomicite fusion/defusion (red before fix)", () => {
  it("ne deplace aucune observation quand deux articles empechent la fusion", async () => {
    const repo = setup();
    const seedSignal = await repo.signals.get("sig_pasqal");
    const templateArticle = (await repo.articles.list())[0];
    const templateObservation = seedSignal
      ? await repo.observations.get(seedSignal.observationIds[0]!)
      : undefined;
    expect(seedSignal).toBeDefined();
    expect(templateArticle).toBeDefined();
    expect(templateObservation).toBeDefined();
    if (!seedSignal || !templateArticle || !templateObservation) return;

    const targetId = "a42-merge-target";
    const sourceId = "a42-merge-source";
    const observationId = "a42-merge-observation";
    const targetArticleId = "a42-merge-target-article";
    const sourceArticleId = "a42-merge-source-article";

    const target = {
      ...seedSignal,
      id: targetId,
      observationIds: [],
      articleId: null,
    };
    const source = {
      ...seedSignal,
      id: sourceId,
      observationIds: [observationId],
      articleId: null,
    };
    await repo.signals.insert(target);
    await repo.signals.insert(source);
    await repo.observations.insert({
      ...templateObservation,
      id: observationId,
      signalId: sourceId,
    });
    await repo.articles.insert({ ...templateArticle, id: targetArticleId, signalId: targetId });
    await repo.articles.insert({ ...templateArticle, id: sourceArticleId, signalId: sourceId });
    await repo.signals.update({ ...target, articleId: targetArticleId });
    await repo.signals.update({ ...source, articleId: sourceArticleId });

    const beforeObservation = await repo.observations.get(observationId);
    const beforeTarget = await repo.signals.get(targetId);
    const beforeSource = await repo.signals.get(sourceId);

    const response = await call("POST", `/signals/${targetId}/merge`, {
      body: { otherIds: [sourceId] },
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await repo.observations.get(observationId)).toEqual(beforeObservation);
    expect(await repo.signals.get(targetId)).toEqual(beforeTarget);
    expect(await repo.signals.get(sourceId)).toEqual(beforeSource);
  });

  it("ne deplace aucune observation si la preparation de la defusion echoue", async () => {
    const repo = setup();
    const original = await repo.signals.get("sig_pasqal");
    expect(original).toBeDefined();
    if (!original) return;
    expect(original.observationIds.length).toBeGreaterThan(1);
    const observationId = original.observationIds[0]!;
    const beforeObservation = await repo.observations.get(observationId);
    const beforeOriginal = await repo.signals.get(original.id);
    const beforeSignals = (await repo.signals.list()).length;

    vi.spyOn(adapters().textModel, "summarize").mockImplementation(() => {
      throw new Error("a42_injected_summary_failure");
    });
    const response = await call("POST", `/signals/${original.id}/split`, {
      body: { observationIds: [observationId] },
    });

    expect(response.status).toBe(500);
    expect(await repo.observations.get(observationId)).toEqual(beforeObservation);
    expect(await repo.signals.get(original.id)).toEqual(beforeOriginal);
    expect((await repo.signals.list()).length).toBe(beforeSignals);
  });
});
