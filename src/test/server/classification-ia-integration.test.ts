import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CollectionRun, Source } from "@/lib/api/types";
import { setAdapters } from "@/server/adapters";
import type { RawItem } from "@/server/adapters/collector";
import type { AiTextEnhancer } from "@/server/adapters/openai";
import { classifyCategory } from "@/server/domain/clustering";
import { getRepository } from "@/server/store/memory";
import { call, NOW, setup, teardown } from "./helpers";

const fr = "Pasqal étend son partenariat avec Openchip pour 5 M€";
const en = "Pasqal extends its partnership with Openchip for 12 months";

function article(url: string, title: string, text: string): RawItem {
  return {
    url,
    title,
    html: `<p>${text}</p>`,
    outlet: {
      name: "Média de test",
      domain: "example.org",
      brand: { initials: "MT", bg: "#111", fg: "#fff" },
    },
    publishedAt: new Date(NOW.getTime() - 86400000).toISOString(),
    eventDate: null,
    via: "google_news",
  };
}

function fakeAi(calls: string[], failEnglish = false): AiTextEnhancer {
  return {
    enhanceDossier: async (_input, base) => base,
    enhanceLinkedInVariants: async (_input, base) => base,
    enhanceSummary: async (_input, base) => base,

    async classify(input) {
      calls.push(input.title);

      if (failEnglish && input.title === en) return null;

      return {
        category: "partenariat",
        importance: 78,
        reason: "Extension de la collaboration industrielle",
        model: "simulation-ia",
      };
    },
  };
}

async function executeCollection(items: RawItem[]) {
  setAdapters({
    collector: {
      name: "collecteur-simule",
      collect: () => ({ ok: true, items }),
    },
  });

  const sources = await call<Source[]>("GET", "/sources?companyId=co_pasqal");

  const source = sources.body.find((s) => s.type === "communiques");

  expect(source).toBeDefined();

  return call<CollectionRun>("POST", `/sources/${source!.id}/collect`);
}

describe("KORA — intégration classification IA", () => {
  beforeEach(() => setup());
  afterEach(teardown);

  it.each([false, true])("regroupe FR/EN avec échec IA anglais = %s", async (failEnglish) => {
    const calls: string[] = [];
    setAdapters({ ai: fakeAi(calls, failEnglish) });

    const items = [
      article(
        "https://example.org/kora-test-fr-openchip",
        fr,
        "Pasqal confirme son partenariat avec Openchip pour 5 M€.",
      ),
      article(
        "https://example.org/kora-test-en-openchip",
        en,
        "Pasqal and Openchip extend their work for twelve months.",
      ),
    ];

    const run = await executeCollection(items);

    expect(run.status).toBe(200);
    expect(run.body.newObservations).toBe(2);
    expect(calls).toHaveLength(2);

    const repo = await getRepository();
    const urls = new Set(items.map((i) => i.url));

    const observations = (await repo.observations.list()).filter((o) => urls.has(o.url));

    expect(observations).toHaveLength(2);

    const signalIds = new Set(observations.map((o) => o.signalId));

    expect(signalIds.size).toBe(1);

    const signalId = observations[0]!.signalId;
    expect(signalId).not.toBeNull();

    const signal = await repo.signals.get(signalId!);

    expect(signal?.category).toBe("partenariat");
    expect(signal?.observationIds).toHaveLength(2);
    expect(signal?.review).toBeNull();
  });

  it("donne priorité à la catégorie IA sur les mots-clés", async () => {
    const title = "Pasqal announces an innovation with Openchip";
    const text = "Pasqal and Openchip will continue their joint work.";

    expect(classifyCategory(`${title} ${text}`)).toBe("innovation");

    const calls: string[] = [];
    setAdapters({ ai: fakeAi(calls) });

    const item = article("https://example.org/kora-test-ia-priorite", title, text);

    const run = await executeCollection([item]);

    expect(run.status).toBe(200);
    expect(run.body.newObservations).toBe(1);
    expect(calls).toEqual([title]);

    const repo = await getRepository();
    const observation = (await repo.observations.list()).find((o) => o.url === item.url);

    expect(observation).toBeDefined();

    const signal = await repo.signals.get(observation!.signalId!);

    expect(signal?.category).toBe("partenariat");
    expect(signal?.assessment?.model).toBe("simulation-ia");
  });
});
