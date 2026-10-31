import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CollectionRun, Source } from "@/lib/api/types";
import { setAdapters } from "@/server/adapters";
import { OpenAiEnhancer } from "@/server/adapters/openai";
import { COSTS } from "@/server/domain/budget";
import { getRepository } from "@/server/store/memory";
import { call, NOW, setup, teardown } from "./helpers";

describe("KORA — traçabilité du repli IA", () => {
  beforeEach(() => setup());

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    teardown();
  });

  it("comptabilise une estimation conservatrice des deux tentatives", async () => {
    vi.stubEnv("AI_API_KEY", "cle-primaire-fictive");
    vi.stubEnv("ANTHROPIC_API_KEY", "cle-secondaire-fictive");
    vi.stubEnv("KORA_AI_FALLBACK_ENABLED", "true");
    vi.stubEnv("KORA_AI_FALLBACK_MODEL", "test/backup-model");
    vi.stubEnv("KORA_AI_FALLBACK_RESERVE_EUR_PER_CALL", String(COSTS.classification));

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input);

      if (url.includes("api.anthropic.com")) {
        return new Response("Unavailable", { status: 503 });
      }

      if (url.includes("api.openai.com")) {
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  category: "partenariat",
                  importance: 78,
                  reason: "Partenariat industriel",
                }),
              },
            },
          ],
        });
      }

      throw new Error("Requête réseau inattendue");
    });

    vi.stubGlobal("fetch", fetchMock);

    const enhancer = new OpenAiEnhancer();

    setAdapters({
      ai: {
        classify: (input) => enhancer.classify(input),
        classifyWithUsage: (input) => enhancer.classifyWithUsage(input),
        enhanceDossier: async (_input, base) => base,
        enhanceLinkedInVariants: async (_input, base) => base,
        enhanceSummary: async (_input, base) => base,
      },
      collector: {
        name: "collecteur-factice",
        collect: () => ({
          ok: true,
          items: [
            {
              url: "https://www.lesechos.fr/pasqal-openchip-test-repli",
              title: "Pasqal étend son partenariat avec Openchip",
              html: "<p>Pasqal et Openchip étendent leur collaboration.</p>",
              outlet: {
                name: "Média de test",
                domain: "lesechos.fr",
                brand: { initials: "MT", bg: "#111", fg: "#fff" },
              },
              publishedAt: new Date(NOW.getTime() - 86400000).toISOString(),
              eventDate: null,
            },
          ],
        }),
      },
    });

    const repo = await getRepository();
    const before = (await repo.usage.list()).length;

    const sources = await call<Source[]>("GET", "/sources?companyId=co_pasqal");

    const source = sources.body.find((s) => s.type === "communiques");

    expect(source).toBeDefined();

    const run = await call<CollectionRun>("POST", `/sources/${source!.id}/collect`);

    expect(run.status).toBe(200);
    expect(run.body.newObservations).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const entries = (await repo.usage.list())
      .slice(before)
      .filter((entry) => entry.kind === "classification");

    const estimatedCost = entries.reduce((total, entry) => total + entry.costEur, 0);

    expect(estimatedCost).toBeCloseTo(COSTS.classification * 2, 6);
  });
});
