import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CollectionRun, Paginated, Signal, Source } from "@/lib/api/types";
import { setAdapters } from "@/server/adapters";
import type { RawItem } from "@/server/adapters/collector";
import { toAssessment, type AiTextEnhancer, type ClassifyInput } from "@/server/adapters/openai";
import { COSTS } from "@/server/domain/budget";
import { assess } from "@/server/domain/scoring";
import { getRepository } from "@/server/store/memory";
import { call, NOW, setup, teardown } from "./helpers";

const outlet = {
  name: "Les Echos",
  domain: "lesechos.fr",
  brand: { initials: "L", bg: "#111", fg: "#fff" },
};

function item(n: number, title: string, html: string): RawItem {
  return {
    url: `https://www.lesechos.fr/pasqal-${n}`,
    title,
    html,
    outlet,
    publishedAt: new Date(NOW.getTime() - n * 3_600_000).toISOString(),
    eventDate: null,
    via: "google_news",
  };
}

/** Modèle factice : juge par le titre, et refuse de répondre sur les titres marqués « muet ». */
function fakeAi(seen: ClassifyInput[]): AiTextEnhancer {
  return {
    enhanceDossier: async (_i, base) => base,
    enhanceLinkedInVariants: async (_i, base) => base,
    enhanceSummary: async (_i, base) => base,
    async classify(input) {
      seen.push(input);
      if (input.title.includes("muet")) return null;
      if (/lève|série/.test(input.title))
        return { category: "financement", importance: 93, reason: "Levée majeure", model: "test" };
      return {
        category: "produit",
        importance: 38,
        reason: "Communication produit sans nouveauté",
        model: "test",
      };
    },
  };
}

describe("évaluation du contenu par le modèle", () => {
  it("valide la réponse du modèle et rejette ce qui sort du format", () => {
    expect(
      toAssessment({ category: "contrat", importance: 77.4, reason: " Contrat cadre " }),
    ).toEqual({
      category: "contrat",
      importance: 77,
      reason: "Contrat cadre",
      model: "gpt-4o-mini",
    });
    expect(toAssessment({ category: "autre" as never, importance: 50, reason: "x" })).toBeNull();
    expect(toAssessment({ category: "contrat", importance: 140, reason: "x" })).toBeNull();
    expect(toAssessment({ category: "contrat", importance: 50, reason: "" })).toBeNull();
    expect(toAssessment(null)).toBeNull();
    expect(
      toAssessment({ category: "contrat", importance: 50, reason: "y".repeat(400) })!.reason,
    ).toHaveLength(200);
  });

  it("remplace l'importance par catégorie par celle du modèle, en gardant la priorité de l'entreprise", () => {
    const base = {
      category: "innovation" as const,
      title: "Titre",
      text: "Texte sans montant",
      company: null,
      observations: [],
      priorSameCategory: false,
      eventLagDays: 0,
    };
    expect(assess(base).subScores.importance).toBe(72);
    const read = assess({
      ...base,
      content: {
        category: "innovation",
        importance: 41,
        reason: "Reprise promotionnelle",
        model: "t",
      },
    });
    expect(read.subScores.importance).toBe(41);
    expect(read.reasons.importance).toBe(
      "Lecture du contenu par le modèle : Reprise promotionnelle",
    );
    const priority = assess({
      ...base,
      company: { priority: "haute", territory: "Meylan", themes: [] } as never,
      content: { category: "innovation", importance: 41, reason: "Reprise", model: "t" },
    });
    expect(priority.subScores.importance).toBe(46);
  });
});

describe("nouveauté selon l'ancienneté de la publication", () => {
  const base = {
    category: "contrat" as const,
    title: "Titre",
    text: "Texte",
    company: null,
    observations: [],
    priorSameCategory: false,
  };
  const nouveaute = (eventLagDays: number | null) =>
    assess({ ...base, eventLagDays }).subScores.nouveaute;

  it("dégrade la note par paliers : du jour, de la semaine, du mois, au-delà", () => {
    expect(nouveaute(0)).toBe(86);
    expect(nouveaute(2)).toBe(86);
    expect(nouveaute(3)).toBe(81);
    expect(nouveaute(7)).toBe(81);
    expect(nouveaute(8)).toBe(74);
    expect(nouveaute(14)).toBe(74);
    expect(nouveaute(15)).toBe(66);
    expect(nouveaute(30)).toBe(66);
    expect(nouveaute(31)).toBe(61);
    expect(nouveaute(null)).toBe(78);
    expect(assess({ ...base, eventLagDays: 20 }).reasons.nouveaute).toContain(
      "antérieur de 20 jours",
    );
  });
});

describe("évaluation du contenu : collecte", () => {
  beforeEach(() => {
    setup();
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      const hours = url.includes("pasqal-50") ? 2 : Number(/pasqal-(\d+)/.exec(url)?.[1] ?? 1);
      const publishedAt = new Date(NOW.getTime() - hours * 3_600_000).toISOString();
      return new Response(
        `<script type="application/ld+json">${JSON.stringify({
          "@type": "NewsArticle",
          datePublished: publishedAt,
        })}</script>`,
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    teardown();
  });

  async function pasqalSource(): Promise<Source> {
    const res = await call<Source[]>("GET", "/sources?companyId=co_pasqal");
    return res.body.find((s) => s.type === "communiques")!;
  }

  it("classe et note les nouvelles publications avec le modèle, et compte les lectures", async () => {
    const seen: ClassifyInput[] = [];
    const repo = await getRepository();
    const known = (await repo.observations.list())[0]!;
    setAdapters({
      ai: fakeAi(seen),
      collector: {
        name: "stub",
        collect: () => ({
          ok: true,
          items: [
            item(
              1,
              "Pasqal boucle une série C de 85 millions d'euros",
              "<p>Pasqal boucle une série C de 85 millions d'euros auprès d'un fonds nordique.</p>",
            ),
            item(
              2,
              "Pasqal présente sa gamme au salon",
              "<p>Pasqal présente sa gamme de processeurs au salon.</p>",
            ),
            item(
              3,
              "Pasqal, un communiqué muet",
              "<p>Pasqal signe un contrat avec un industriel.</p>",
            ),
            { ...item(4, "Déjà connu", "<p>Déjà connu.</p>"), url: known.url },
          ],
        }),
      },
    });
    const src = await pasqalSource();
    const entriesBefore = (await repo.usage.list()).length;
    const run = await call<CollectionRun>("POST", `/sources/${src.id}/collect`);
    expect(run.body).toMatchObject({ status: "succes", newObservations: 3 });
    // La publication déjà connue n'est pas soumise au modèle ; les textes le sont nettoyés.
    expect(seen.map((i) => i.title)).toEqual([
      "Pasqal boucle une série C de 85 millions d'euros",
      "Pasqal présente sa gamme au salon",
      "Pasqal, un communiqué muet",
    ]);
    expect(seen[0]!.text).toBe(
      "Pasqal boucle une série C de 85 millions d'euros auprès d'un fonds nordique.",
    );
    expect(seen[0]!.companyName).toBe("Pasqal");

    const find = async (q: string) =>
      (await call<Paginated<Signal>>("GET", `/signals?q=${encodeURIComponent(q)}&status=tous`)).body
        .items[0]!;
    // Pasqal est prioritaire dans le registre : +5 sur l'importance, lecture ou non.
    const bonus = (await repo.companies.get("co_pasqal"))!.priority === "haute" ? 5 : 0;
    const levee = await find("série C");
    expect(levee.category).toBe("financement");
    expect(levee.assessment).toMatchObject({ importance: 93, model: "test" });
    expect(levee.score.subScores.importance).toBe(93 + bonus);
    expect(levee.score.reasons.importance).toContain("Levée majeure");
    const gamme = await find("gamme au salon");
    expect(gamme.score.subScores.importance).toBe(38 + bonus);
    expect(gamme.score.total).toBeLessThan(levee.score.total);
    // Sans réponse du modèle : indices lexicaux (« contrat ») et importance par catégorie (74).
    const muet = await find("communiqué muet");
    expect(muet.assessment).toBeNull();
    expect(muet.category).toBe("contrat");
    expect(muet.score.subScores.importance).toBe(74 + bonus);

    const entries = (await repo.usage.list()).slice(entriesBefore);
    const lecture = entries.find((u) => u.kind === "classification")!;
    expect(lecture).toMatchObject({ units: 2, label: `Lecture par le modèle ${src.label}` });
    expect(lecture.costEur).toBeCloseTo(2 * COSTS.classification, 6);
  });

  it("recalcule le score d'un signal évalué avec la même lecture quand une publication s'y ajoute", async () => {
    const seen: ClassifyInput[] = [];
    setAdapters({
      ai: fakeAi(seen),
      collector: {
        name: "stub",
        collect: () => ({
          ok: true,
          items: [
            item(
              1,
              "Pasqal lève 50 millions pour son usine de Meylan",
              "<p>Pasqal lève 50 millions pour son usine de Meylan.</p>",
            ),
          ],
        }),
      },
    });
    const src = await pasqalSource();
    await call("POST", `/sources/${src.id}/collect`);
    const before = (
      await call<Paginated<Signal>>("GET", "/signals?q=usine%20de%20Meylan&status=tous")
    ).body.items[0]!;
    setAdapters({
      collector: {
        name: "stub",
        collect: () => ({
          ok: true,
          items: [
            {
              ...item(
                2,
                "Pasqal lève 50 millions pour son usine de Meylan",
                "<p>La pépite quantique finance l'extension de son site de Meylan avec 50 millions.</p>",
              ),
              outlet: { ...outlet, name: "La Tribune", domain: "latribune.fr" },
              url: "https://www.latribune.fr/pasqal-50",
            },
          ],
        }),
      },
    });
    await call("POST", `/sources/${src.id}/collect`);
    const after = (await call<Signal>("GET", `/signals/${before.id}`)).body;
    expect(after.observationIds).toHaveLength(2);
    expect(after.assessment).toEqual(before.assessment);
    expect(after.score.subScores.importance).toBe(before.score.subScores.importance);
    expect(after.score.subScores.diffusion).toBeGreaterThan(before.score.subScores.diffusion);
    expect(seen).toHaveLength(2);
  });
});
