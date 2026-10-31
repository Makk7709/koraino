import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CollectionRun, Source, UsageSnapshot } from "@/lib/api/types";
import { setAdapters } from "@/server/adapters";
import type { AiTextEnhancer } from "@/server/adapters/openai";
import { COSTS } from "@/server/domain/budget";
import { getRepository } from "@/server/store/memory";
import { call, NOW, setup, teardown } from "./helpers";

function sample(n: number) {
  return {
    url: `https://www.lesechos.fr/kora-resume-budget-test-${n}`,
    title: `Pasqal annonce un projet expérimental distinct numéro ${n}`,
    html: `<p>Pasqal présente une expérimentation technique numéro ${n}.</p>`,
    outlet: {
      name: "Journal test",
      domain: "lesechos.fr",
      brand: { initials: "JT", bg: "#111", fg: "#fff" },
    },
    publishedAt: new Date(NOW.getTime() - 86_400_000).toISOString(),
    eventDate: null,
  };
}

function fakeAi(enhanceSummary: AiTextEnhancer["enhanceSummary"]): AiTextEnhancer {
  return {
    enhanceDossier: async (_input, base) => base,
    enhanceLinkedInVariants: async (_input, base) => base,
    enhanceSummary,
    classify: async () => null,
    classifyWithUsage: async () => ({ assessment: null, primaryCalls: 1, fallbackCalls: 0 }),
  };
}

async function collect(items: ReturnType<typeof sample>[]) {
  setAdapters({ collector: { name: "stub", collect: () => ({ ok: true, items }) } });
  const sources = await call<Source[]>("GET", "/sources?companyId=co_pasqal");
  const source = sources.body.find((value) => value.type === "communiques");
  expect(source).toBeDefined();
  return call<CollectionRun>("POST", `/sources/${source!.id}/collect`);
}

describe("KORA — réserve budgétaire des résumés IA", () => {
  beforeEach(() => {
    setup();
    vi.stubEnv("ANTHROPIC_API_KEY", "cle-haiku-fictive");
    vi.stubEnv("AI_API_KEY", "");
    vi.stubEnv("KORA_AI_FALLBACK_ENABLED", "false");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    teardown();
  });

  it("réserve et comptabilise un résumé, sans conserver de réservation", async () => {
    const summary = "Résumé expérimental corrigé et validé par le modèle factice.";
    const enhance = vi.fn(async () => summary);
    setAdapters({ ai: fakeAi(enhance) });
    const repo = await getRepository();
    const before = (await repo.usage.list()).length;
    const response = await collect([sample(1)]);
    expect(response.status).toBe(200);
    expect(response.body.newObservations).toBe(1);
    expect(enhance).toHaveBeenCalledTimes(1);
    const lines = (await repo.usage.list())
      .slice(before)
      .filter((line) => line.kind === "generation_summary");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ costEur: COSTS.summary, units: 1 });
    expect((await repo.getSettings()).reservedEur).toBe(0);
    expect((await repo.signals.list()).some((signal) => signal.summary === summary)).toBe(true);
  });

  it("interdit l'amélioration si le budget couvre seulement la collecte", async () => {
    const enhance = vi.fn(async () => "Ne doit pas être appelé");
    setAdapters({ ai: fakeAi(enhance) });
    const repo = await getRepository();
    const before = (await repo.usage.list()).length;
    const settings = await repo.getSettings();
    const snapshot = await call<UsageSnapshot>("GET", "/usage");
    const used = snapshot.body.meters.find((meter) => meter.key === "api_budget_eur")!.used;
    settings.quotaLimits.api_budget_eur =
      used + COSTS.search + 5 * (COSTS.observation + COSTS.classification);
    await repo.saveSettings(settings);
    const response = await collect([1, 2, 3, 4, 5].map(sample));
    expect(response.status).toBe(200);
    expect(response.body.newObservations).toBe(5);
    expect(enhance).not.toHaveBeenCalled();
    expect(
      (await repo.usage.list()).slice(before).filter((line) => line.kind === "generation_summary"),
    ).toHaveLength(0);
    expect((await repo.getSettings()).reservedEur).toBe(0);
  });

  it("ne déclenche aucune amélioration sans clé Haiku", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const enhance = vi.fn(async () => "Ne doit pas être appelé");
    setAdapters({ ai: fakeAi(enhance) });
    const repo = await getRepository();
    const before = (await repo.usage.list()).length;
    const response = await collect([sample(77)]);
    expect(response.status).toBe(200);
    expect(enhance).not.toHaveBeenCalled();
    expect(
      (await repo.usage.list()).slice(before).filter((line) => line.kind === "generation_summary"),
    ).toHaveLength(0);
  });

  it("un échec d'amélioration conserve l'exposition inconnue sans annuler la collecte", async () => {
    const enhance = vi.fn(async (): Promise<string> => {
      throw new Error("simulation");
    });
    setAdapters({ ai: fakeAi(enhance) });
    const repo = await getRepository();
    const response = await collect([sample(99)]);
    expect(response.status).toBe(200);
    expect(response.body.newObservations).toBe(1);
    expect(enhance).toHaveBeenCalledTimes(1);
    // La fonction simulée échoue : l'orchestrateur ne peut pas prouver
    // que la requête fournisseur n'a pas été facturée.
    expect((await repo.getSettings()).reservedEur).toBeCloseTo(COSTS.summary);
  });
});
