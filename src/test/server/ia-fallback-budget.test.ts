import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiErrorBody, CollectionRun, Source, UsageSnapshot } from "@/lib/api/types";
import { setAdapters } from "@/server/adapters";
import { OpenAiEnhancer } from "@/server/adapters/openai";
import { COSTS } from "@/server/domain/budget";
import { estimatedTextAiCost } from "@/server/services/ai-estimate";
import { getRepository } from "@/server/store/memory";
import { call, setup, teardown } from "./helpers";

describe("KORA — budget de la bascule IA", () => {
  beforeEach(() => setup());

  afterEach(() => {
    vi.unstubAllEnvs();
    teardown();
  });

  it("refuse une réserve de secours avec cinq décimales", () => {
    vi.stubEnv("KORA_AI_FALLBACK_ENABLED", "true");
    vi.stubEnv("ANTHROPIC_API_KEY", "fake-haiku");
    vi.stubEnv("AI_API_KEY", "fake-openai");
    vi.stubEnv("KORA_AI_FALLBACK_RESERVE_EUR_PER_CALL", "0.00001");
    expect(() => estimatedTextAiCost(COSTS.summary)).toThrow();
  });

  it("accepte une réserve exacte sur quatre décimales", () => {
    vi.stubEnv("KORA_AI_FALLBACK_ENABLED", "true");
    vi.stubEnv("ANTHROPIC_API_KEY", "fake-haiku");
    vi.stubEnv("AI_API_KEY", "fake-openai");
    vi.stubEnv("KORA_AI_FALLBACK_RESERVE_EUR_PER_CALL", "0.0001");
    expect(estimatedTextAiCost(COSTS.summary)).toBe(0.0201);
  });

  it("refuse la collecte si le budget ne couvre pas deux modèles", async () => {
    vi.stubEnv("KORA_AI_FALLBACK_ENABLED", "true");
    vi.stubEnv("AI_API_KEY", "cle-primaire-fictive");
    vi.stubEnv("KORA_AI_FALLBACK_RESERVE_EUR_PER_CALL", String(COSTS.classification));
    vi.stubEnv("ANTHROPIC_API_KEY", "cle-fictive");
    vi.stubEnv("KORA_AI_FALLBACK_MODEL", "test/backup-model");

    const repo = await getRepository();
    const usageResponse = await call<UsageSnapshot>("GET", "/usage");
    expect(usageResponse.status).toBe(200);
    const usage = usageResponse.body;

    const used = usage.meters.find((m) => m.key === "api_budget_eur")!.used;

    const maxItems = 5;

    const oneModel = COSTS.search + maxItems * (COSTS.observation + COSTS.classification);

    const extraModel = maxItems * COSTS.classification;

    const settings = await repo.getSettings();

    // Suffisant pour un seul modèle, insuffisant pour deux.
    settings.quotaLimits.api_budget_eur = used + oneModel + extraModel / 2;

    await repo.saveSettings(settings);

    const collectSpy = vi.fn(async () => ({
      ok: true as const,
      items: [],
    }));

    setAdapters({
      ai: new OpenAiEnhancer(),
      collector: {
        name: "collecteur-factice",
        collect: collectSpy,
      },
    });

    const sources = await call<Source[]>("GET", "/sources?companyId=co_pasqal");

    const source = sources.body.find((s) => s.type === "communiques");

    expect(source).toBeDefined();

    const response = await call<ApiErrorBody>("POST", `/sources/${source!.id}/collect`);

    expect(response.status).toBe(402);
    expect(response.body.error.code).toBe("budget_exhausted");
    expect(collectSpy).not.toHaveBeenCalled();

    const runs = await call<CollectionRun[]>(
      "GET",
      `/collection-runs?sourceId=${source!.id}&limit=1`,
    );

    expect(runs.body[0]?.status).toBe("bloque_quota");
  });
});
