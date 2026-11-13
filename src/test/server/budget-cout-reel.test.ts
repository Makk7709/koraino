import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ApiErrorBody,
  ArticleDetail,
  CollectionRun,
  Notification,
  Signal,
  SignalDetail,
  Source,
  UsageSnapshot,
} from "@/lib/api/types";
import { setAdapters } from "@/server/adapters";
import { RealCollector, type RawItem } from "@/server/adapters/collector";
import { OpenAiEnhancer, type AiTextEnhancer } from "@/server/adapters/openai";
import { TemplateTextModel } from "@/server/adapters/text-model";
import { DEFAULT_LIMITS, MAX_COSTS, monthTotals } from "@/server/domain/budget";
import { monthKey } from "@/server/domain/dates";
import {
  ApiMeter,
  OPENAI_CALLS,
  openAiCostEur,
  PERPLEXITY_SEARCH_EUR,
} from "@/server/domain/pricing";
import { MAX_ITEMS } from "@/server/services/collection";
import { paidCall } from "@/server/services/usage";
import { getRepository } from "@/server/store/memory";
import type { CompanyRecord, SourceRecord, UsageEntry } from "@/server/store/records";
import { call, NOW, setup, teardown, USERS } from "./helpers";

const meterOf = (u: UsageSnapshot, key: string) => u.meters.find((m) => m.key === key)!;

/** Consommation du mois, au millionième d'euro. */
async function spent(): Promise<number> {
  return monthTotals(await (await getRepository()).usage.list(), monthKey(NOW)).costEur;
}

/** Lignes de consommation ajoutées depuis `from`. */
async function entriesSince(from: number): Promise<UsageEntry[]> {
  return (await (await getRepository()).usage.list()).slice(from);
}

async function entryCount(): Promise<number> {
  return (await (await getRepository()).usage.list()).length;
}

async function setLimit(limit: number) {
  const repo = await getRepository();
  const settings = await repo.getSettings();
  settings.quotaLimits.api_budget_eur = limit;
  await repo.saveSettings(settings);
}

interface FakeCosts {
  dossier?: number;
  linkedin?: number;
  summary?: number;
  reading?: number;
}

/** Modèle factice : réécrit les résumés et ajoute au compteur le coût de chaque requête. */
function fakeAi(costs: FakeCosts = {}) {
  const calls: string[] = [];
  const ai: AiTextEnhancer = {
    async enhanceDossier(_input, base, meter) {
      calls.push("dossier");
      meter?.add(costs.dossier ?? 0);
      return base;
    },
    async enhanceLinkedInVariants(_input, base, meter) {
      calls.push("linkedin");
      meter?.add(costs.linkedin ?? 0);
      return base;
    },
    async enhanceSummary(input, _base, meter) {
      calls.push("summary");
      meter?.add(costs.summary ?? 0);
      return `Résumé réécrit : ${input.title}`;
    },
    async classify(_input, meter) {
      calls.push("reading");
      meter?.add(costs.reading ?? 0);
      return { category: "produit", importance: 60, reason: "Annonce ordinaire", model: "test" };
    },
  };
  setAdapters({ ai });
  return calls;
}

function item(n: number, title: string): RawItem {
  return {
    url: `https://www.pasqal.com/actualites/${n}`,
    title,
    html: `<p>${title} : le détail de l'annonce publiée par l'entreprise.</p>`,
    outlet: {
      name: "Pasqal",
      domain: "pasqal.com",
      brand: { initials: "P", bg: "#111", fg: "#fff" },
    },
    publishedAt: new Date(NOW.getTime() - n * 3_600_000).toISOString(),
    eventDate: null,
    via: "flux",
  };
}

const NEWS = [
  item(1, "Pasqal ouvre un laboratoire à Sherbrooke"),
  item(2, "Pasqal livre un processeur à un centre de calcul"),
];

async function pasqalSource(): Promise<Source> {
  const res = await call<Source[]>("GET", "/sources?companyId=co_pasqal");
  return res.body.find((s) => s.type === "communiques")!;
}

describe("tarifs des fournisseurs", () => {
  it("calcule le coût d'un appel OpenAI d'après les jetons facturés", () => {
    // gpt-4o-mini : 0,15 $ le million de jetons soumis, 0,60 $ le million de jetons produits.
    expect(openAiCostEur("gpt-4o-mini", 1_000_000, 0)).toBeCloseTo(0.15, 9);
    expect(openAiCostEur("gpt-4o-mini", 0, 1_000_000)).toBeCloseTo(0.6, 9);
    expect(openAiCostEur("gpt-4o-mini", 1200, 300)).toBeCloseTo(0.00036, 9);
  });

  it("compte une recherche Perplexity à 5 $ les 1 000 requêtes", () => {
    expect(PERPLEXITY_SEARCH_EUR).toBeCloseTo(0.005, 9);
  });

  it("réserve un coût maximal qui couvre la réponse la plus longue de chaque appel", () => {
    for (const kind of ["article", "linkedin", "summary", "classification"] as const) {
      const longestAnswer = openAiCostEur("gpt-4o-mini", 0, OPENAI_CALLS[kind].maxOutputTokens);
      expect(MAX_COSTS[kind]).toBeGreaterThan(longestAnswer);
      // Un centime au plus : très loin des anciens forfaits (0,45 € par article).
      expect(MAX_COSTS[kind]).toBeLessThan(0.01);
    }
    expect(MAX_COSTS.search).toBe(PERPLEXITY_SEARCH_EUR);
    expect(DEFAULT_LIMITS.api_budget_eur).toBe(150);
  });

  it("additionne des coûts infimes sans dérive, et reporte un compteur enfant sur son parent", () => {
    const lot = new ApiMeter();
    const source = lot.child();
    for (let i = 0; i < 10; i++) source.add(0.0001);
    lot.add(0.005);
    source.add(0);
    source.add(Number.NaN);
    expect(source.costEur).toBe(0.001);
    expect(lot.costEur).toBe(0.006);
  });

  it("garde les coûts au millionième d'euro dans le total du mois", () => {
    const line = (costEur: number): UsageEntry => ({
      id: `use_${costEur}`,
      at: NOW.toISOString(),
      kind: "classification",
      units: 1,
      costEur,
      label: "Lecture",
    });
    const totals = monthTotals(
      Array.from({ length: 5 }, () => line(0.00004)),
      monthKey(NOW),
    );
    expect(totals.costEur).toBe(0.0002);
  });
});

describe("coût mesuré des appels OpenAI", () => {
  beforeEach(() => {
    process.env["AI_API_KEY"] = "cle-test";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env["AI_API_KEY"];
  });

  const INPUT = { title: "Pasqal lève des fonds", text: "Pasqal boucle une série C." };
  const ANSWER = "Pasqal boucle une série C auprès d'un fonds nordique.";
  /** Coût maximal d'un résumé dont le décompte est inconnu : au moins la réponse la plus longue. */
  const LONGEST_ANSWER = openAiCostEur("gpt-4o-mini", 0, OPENAI_CALLS.summary.maxOutputTokens);

  async function summarize(response: () => Response | Promise<Response>) {
    vi.stubGlobal("fetch", vi.fn(response));
    const meter = new ApiMeter();
    const summary = await new OpenAiEnhancer().enhanceSummary(INPUT, "gabarit", meter);
    return { summary, costEur: meter.costEur };
  }

  it("ajoute au compteur le coût des jetons facturés par la réponse", async () => {
    const { summary, costEur } = await summarize(() =>
      Response.json({
        choices: [{ message: { content: ANSWER } }],
        usage: { prompt_tokens: 1200, completion_tokens: 300 },
      }),
    );
    expect(summary).toBe(ANSWER);
    expect(costEur).toBe(0.00036);
  });

  it("compte les quatre types d'appel, y compris quand la réponse est écartée", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          choices: [{ message: { content: "hors format" } }],
          usage: { prompt_tokens: 1000, completion_tokens: 100 },
        }),
      ),
    );
    const each = openAiCostEur("gpt-4o-mini", 1000, 100);
    const ai = new OpenAiEnhancer();
    const meter = new ApiMeter();
    const dossierInput = {
      signal: {
        title: "T",
        summary: "S",
        category: "financement" as const,
        tags: [],
        suggestedAngle: { text: "", tags: [] },
      },
      company: null,
      observations: [],
      angle: null,
      rules: [],
    };
    const dossier = new TemplateTextModel().generateDossier(dossierInput);
    expect(await ai.enhanceDossier(dossierInput, dossier, meter)).toBe(dossier);
    expect(meter.costEur).toBeCloseTo(each, 9);
    const variants = [{ text: "x", hashtags: ["#a"] }];
    const post = { title: "T", lead: "L", companyName: null, themes: [], tags: [] };
    expect(await ai.enhanceLinkedInVariants(post, variants, meter)).toBe(variants);
    expect(meter.costEur).toBeCloseTo(2 * each, 9);
    expect(await ai.classify({ title: "T", text: "X", companyName: null }, meter)).toBeNull();
    expect(meter.costEur).toBeCloseTo(3 * each, 9);
    expect(await ai.enhanceSummary(INPUT, "gabarit", meter)).toBe("gabarit");
    expect(meter.costEur).toBeCloseTo(4 * each, 9);
  });

  it("ne compte rien quand le fournisseur refuse la requête", async () => {
    for (const status of [401, 429, 500]) {
      const { summary, costEur } = await summarize(() => new Response("refus", { status }));
      expect(summary).toBe("gabarit");
      expect(costEur).toBe(0);
    }
  });

  it("ne compte rien quand la requête n'a pas pu partir", async () => {
    const { summary, costEur } = await summarize(() => {
      throw new TypeError("fetch failed");
    });
    expect(summary).toBe("gabarit");
    expect(costEur).toBe(0);
  });

  it("compte le coût maximal quand le délai est dépassé : la requête a pu être facturée", async () => {
    const { summary, costEur } = await summarize(() => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    expect(summary).toBe("gabarit");
    expect(costEur).toBeGreaterThan(LONGEST_ANSWER);
    expect(costEur).toBeLessThan(MAX_COSTS.summary);
  });

  it("compte le coût maximal quand la réponse n'indique pas les jetons facturés", async () => {
    const { summary, costEur } = await summarize(() =>
      Response.json({ choices: [{ message: { content: ANSWER } }] }),
    );
    expect(summary).toBe(ANSWER);
    expect(costEur).toBeGreaterThan(LONGEST_ANSWER);
  });

  it("compte le coût maximal quand la réponse acceptée est illisible", async () => {
    const { summary, costEur } = await summarize(() => new Response("<html>", { status: 200 }));
    expect(summary).toBe("gabarit");
    expect(costEur).toBeGreaterThan(LONGEST_ANSWER);
  });
});

describe("coût mesuré des recherches Perplexity", () => {
  const KEYS = { LOVABLE_API_KEY: "cle-passerelle", PERPLEXITY_API_KEY: "cle-connexion" };
  const company = {
    id: "co_kalray",
    name: "Kalray",
    aliases: [],
    domain: "kalray.eu",
    brand: { initials: "KA", bg: "#111", fg: "#fff" },
  } as unknown as CompanyRecord;
  const press = {
    id: "src_kalray_web",
    type: "recherche_web",
    label: "Kalray",
    url: "https://websearch.invalid/",
  } as unknown as SourceRecord;
  const feed = { ...press, id: "src_kalray_flux", type: "flux_rss", url: "https://kalray.eu/feed" };

  const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><item>
  <title>Kalray signe avec Openchip - Boursier.com</title>
  <link>https://news.google.com/rss/articles/1</link>
  <pubDate>${new Date(NOW.getTime() - 86_400_000).toUTCString()}</pubDate>
  <description>Kalray signe avec Openchip</description>
  <source url="https://www.boursier.com">Boursier.com</source>
</item></channel></rss>`;

  function stubFetch(perplexity: () => Response, rss: () => Response = () => new Response(RSS)) {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      return url.includes("/perplexity/search") ? perplexity() : rss();
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  afterEach(() => vi.unstubAllGlobals());

  const input = (source: SourceRecord, meter: ApiMeter, attempt = 1) => ({
    source,
    company,
    attempt,
    now: NOW,
    knownEvents: [],
    meter,
  });

  it("compte une requête réussie, même sans résultat", async () => {
    stubFetch(() => Response.json({ results: [] }));
    const meter = new ApiMeter();
    const result = await new RealCollector(KEYS).collect(input(press, meter));
    expect(result.ok && result.enrichment).toMatchObject({ status: "ok", received: 0 });
    expect(meter.costEur).toBe(PERPLEXITY_SEARCH_EUR);
  });

  it("ne compte pas une requête en échec, ni une recherche sans clé", async () => {
    stubFetch(() => new Response("indisponible", { status: 503 }));
    const failed = new ApiMeter();
    const result = await new RealCollector(KEYS).collect(input(press, failed));
    expect(result.ok && result.enrichment).toMatchObject({ status: "erreur" });
    expect(failed.costEur).toBe(0);

    const fetchMock = stubFetch(() => Response.json({ results: [] }));
    const unconfigured = new ApiMeter();
    await new RealCollector({}).collect(input(press, unconfigured));
    expect(unconfigured.costEur).toBe(0);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("perplexity"))).toBe(false);
  });

  it("ne coûte rien pour un flux RSS : aucune recherche payante n'est lancée", async () => {
    const fetchMock = stubFetch(() => Response.json({ results: [] }));
    const meter = new ApiMeter();
    const result = await new RealCollector(KEYS).collect(
      input(feed as unknown as SourceRecord, meter),
    );
    expect(result.ok).toBe(true);
    expect(meter.costEur).toBe(0);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("perplexity"))).toBe(false);
  });

  it("ne compte qu'une fois la recherche quand Google News est réessayé", async () => {
    let googleCalls = 0;
    const fetchMock = stubFetch(
      () => Response.json({ results: [] }),
      () => {
        googleCalls += 1;
        return googleCalls === 1 ? new Response("délai", { status: 503 }) : new Response(RSS);
      },
    );
    const collector = new RealCollector(KEYS);
    const meter = new ApiMeter();
    // Perplexity a répondu : Google News en échec ne fait pas échouer la collecte.
    expect((await collector.collect(input(press, meter, 1))).ok).toBe(true);
    expect((await collector.collect(input(press, meter, 2))).ok).toBe(true);
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("perplexity"))).toHaveLength(1);
    expect(meter.costEur).toBe(PERPLEXITY_SEARCH_EUR);
  });

  it("compte la recherche déjà partie quand la page Google News n'est pas un flux", async () => {
    stubFetch(
      () => Response.json({ results: [] }),
      () => new Response("<html><body>Vérification</body></html>"),
    );
    const meter = new ApiMeter();
    const result = await new RealCollector(KEYS).collect(input(press, meter));
    expect(result).toMatchObject({ ok: false, code: "NO_FEED" });
    expect(meter.costEur).toBe(PERPLEXITY_SEARCH_EUR);
  });
});

describe("budget API : coût réel enregistré", () => {
  beforeEach(() => setup());
  afterEach(teardown);

  it("génère un article au coût mesuré, pas à la réservation", async () => {
    const calls = fakeAi({ dossier: 0.0031 });
    const before = await spent();
    const from = await entryCount();
    const art = await call<ArticleDetail>("POST", "/articles", {
      body: { signalId: "sig_verkor" },
      user: USERS.redacteur,
    });
    expect(art.status).toBe(201);
    expect(calls).toEqual(["dossier"]);
    const [line] = await entriesSince(from);
    expect(line).toMatchObject({ kind: "generation_article", units: 1, costEur: 0.0031 });
    expect((await spent()) - before).toBeCloseTo(0.0031, 9);
    expect((await (await getRepository()).getSettings()).reservedEur).toBe(0);
  });

  it("compte aussi le post LinkedIn et le résumé de newsletter au coût mesuré", async () => {
    fakeAi({ linkedin: 0.0007, summary: 0.0002 });
    const from = await entryCount();
    expect((await call("POST", "/linkedin", { body: { signalId: "sig_verkor" } })).status).toBe(
      201,
    );
    const include = await call("PATCH", "/signals/sig_wattpark", { body: { inNewsletter: true } });
    expect(include.status).toBe(200);
    const lines = await entriesSince(from);
    expect(lines.map((l) => [l.kind, l.units, l.costEur])).toEqual([
      ["generation_linkedin", 1, 0.0007],
      ["generation_summary", 1, 0.0002],
    ]);
  });

  it("sans clé IA, les quotas d'unités avancent mais aucun euro n'est compté", async () => {
    const before = await call<UsageSnapshot>("GET", "/usage");
    const art = await call("POST", "/articles", {
      body: { signalId: "sig_verkor" },
      user: USERS.redacteur,
    });
    expect(art.status).toBe(201);
    const after = await call<UsageSnapshot>("GET", "/usage");
    expect(meterOf(after.body, "articles").used).toBe(meterOf(before.body, "articles").used + 1);
    expect(meterOf(after.body, "api_budget_eur").used).toBe(
      meterOf(before.body, "api_budget_eur").used,
    );
  });

  it("enregistre en entier un coût mesuré supérieur à la réservation", async () => {
    const cost = MAX_COSTS.article * 3;
    fakeAi({ dossier: cost });
    const before = await spent();
    await call("POST", "/articles", { body: { signalId: "sig_verkor" }, user: USERS.redacteur });
    expect((await spent()) - before).toBeCloseTo(cost, 9);
    expect((await (await getRepository()).getSettings()).reservedEur).toBe(0);
  });

  it("garde le coût des requêtes déjà facturées quand l'appel est interrompu", async () => {
    const repo = await getRepository();
    const user = (await repo.users.list())[0]!;
    const from = await entryCount();
    await expect(
      paidCall(
        { repo, user, now: NOW },
        { kind: "generation_article", estimate: MAX_COSTS.article, units: 1, label: "Dossier" },
        (meter) => {
          meter.add(0.002);
          throw new Error("base indisponible");
        },
      ),
    ).rejects.toThrow("base indisponible");
    expect(await entriesSince(from)).toMatchObject([
      { kind: "generation_article", units: 0, costEur: 0.002, label: "Dossier (interrompu)" },
    ]);
    expect((await repo.getSettings()).reservedEur).toBe(0);
  });

  it("au plafond, aucun appel au modèle ne part", async () => {
    await setLimit(await spent());
    const calls = fakeAi({ dossier: 0.003 });
    const art = await call<ApiErrorBody>("POST", "/articles", {
      body: { signalId: "sig_verkor" },
      user: USERS.redacteur,
    });
    expect(art.status).toBe(402);
    expect(art.body.error.code).toBe("budget_exhausted");
    expect(calls).toEqual([]);
  });
});

describe("budget API : collecte", () => {
  beforeEach(() => setup());
  afterEach(teardown);

  function collector(items: RawItem[], searchEur = 0) {
    setAdapters({
      collector: {
        name: "stub",
        collect: (input) => {
          input.meter?.add(searchEur);
          return { ok: true, items };
        },
      },
    });
  }

  it("un flux gratuit ne coûte rien : seuls les volumes sont comptés", async () => {
    collector(NEWS);
    const src = await pasqalSource();
    const before = await spent();
    const from = await entryCount();
    const run = await call<CollectionRun>("POST", `/sources/${src.id}/collect`);
    expect(run.body).toMatchObject({ status: "succes", newObservations: 2 });
    expect((await entriesSince(from)).map((l) => [l.kind, l.units, l.costEur])).toEqual([
      ["search_query", 1, 0],
      ["observation", 2, 0],
    ]);
    expect(await spent()).toBe(before);
  });

  it("compte la recherche Perplexity, les lectures et les résumés au coût mesuré", async () => {
    collector(NEWS, PERPLEXITY_SEARCH_EUR);
    const calls = fakeAi({ reading: 0.0002, summary: 0.0001 });
    const src = await pasqalSource();
    const before = await spent();
    const from = await entryCount();
    const run = await call<CollectionRun>("POST", `/sources/${src.id}/collect`);
    expect(run.body).toMatchObject({ status: "succes", newObservations: 2 });
    expect(calls.sort()).toEqual(["reading", "reading", "summary", "summary"]);

    const lines = await entriesSince(from);
    expect(lines.map((l) => [l.kind, l.units, l.costEur])).toEqual([
      ["search_query", 1, 0.005],
      ["observation", 2, 0],
      ["classification", 2, 0.0004],
      ["generation_summary", 2, 0.0002],
    ]);
    expect(lines[3]!.label).toBe("Résumés de 2 signaux collectés");
    expect((await spent()) - before).toBeCloseTo(0.0056, 9);
    expect((await (await getRepository()).getSettings()).reservedEur).toBe(0);

    // Les résumés réécrits sont enregistrés sur les signaux créés.
    const detail = await call<{ items: Signal[] }>(
      "GET",
      `/signals?q=${encodeURIComponent("Sherbrooke")}&status=tous`,
    );
    expect(detail.body.items[0]!.summary).toBe(
      "Résumé réécrit : Pasqal ouvre un laboratoire à Sherbrooke",
    );
  });

  it("plafond atteint pendant le lot : les résumés ne sont pas réécrits, la collecte aboutit", async () => {
    // Le lot passe tout juste ; ses lectures coûtent plus que prévu et ferment le plafond.
    const estimate = MAX_COSTS.search + MAX_ITEMS * MAX_COSTS.classification;
    await setLimit((await spent()) + estimate + 0.0001);
    collector(NEWS);
    const calls = fakeAi({ reading: estimate, summary: 0.0001 });
    const src = await pasqalSource();
    const from = await entryCount();
    const run = await call<CollectionRun>("POST", `/sources/${src.id}/collect`);
    expect(run.body).toMatchObject({ status: "succes", newObservations: 2 });
    expect(calls).toEqual(["reading", "reading"]);
    expect((await entriesSince(from)).map((l) => l.kind)).toEqual([
      "search_query",
      "observation",
      "classification",
    ]);

    const signals = await call<{ items: Signal[] }>(
      "GET",
      `/signals?q=${encodeURIComponent("Sherbrooke")}&status=tous`,
    );
    expect(signals.body.items[0]!.summary).not.toContain("Résumé réécrit");
    const usage = await call<UsageSnapshot>("GET", "/usage");
    expect(usage.body.paidCallsSuspended).toBe(true);
    const notifications = await call<Notification[]>("GET", "/notifications");
    expect(notifications.body.map((n) => n.title)).toContain(
      "Budget API : appels payants suspendus",
    );
    expect((await (await getRepository()).getSettings()).reservedEur).toBe(0);
  });

  it("budget épuisé : ni recherche, ni lecture, ni résumé", async () => {
    await setLimit(await spent());
    let collected = 0;
    setAdapters({
      collector: {
        name: "stub",
        collect: () => {
          collected += 1;
          return { ok: true, items: NEWS };
        },
      },
    });
    const calls = fakeAi({ reading: 0.0002, summary: 0.0001 });
    const src = await pasqalSource();
    const res = await call<ApiErrorBody>("POST", `/sources/${src.id}/collect`);
    expect(res.status).toBe(402);
    expect(collected).toBe(0);
    expect(calls).toEqual([]);
  });
});

describe("budget API : résumé d'un signal défusionné", () => {
  beforeEach(() => setup());
  afterEach(teardown);

  async function split() {
    const detail = await call<SignalDetail>("GET", "/signals/sig_pasqal");
    const tribune = detail.body.observations.find((o) => o.outlet.domain === "latribune.fr")!;
    const res = await call<{ original: Signal; created: Signal }>(
      "POST",
      "/signals/sig_pasqal/split",
      { body: { observationIds: [tribune.id] } },
    );
    return { res, tribune };
  }

  it("réserve et compte la réécriture du résumé", async () => {
    const calls = fakeAi({ summary: 0.0002 });
    const from = await entryCount();
    const { res, tribune } = await split();
    expect(res.status).toBe(201);
    expect(calls).toEqual(["summary"]);
    expect(res.body.created.summary).toBe(`Résumé réécrit : ${tribune.title}`);
    expect(await entriesSince(from)).toMatchObject([
      {
        kind: "generation_summary",
        units: 1,
        costEur: 0.0002,
        label: `Résumé du signal défusionné : ${tribune.title}`,
      },
    ]);
    expect((await (await getRepository()).getSettings()).reservedEur).toBe(0);
  });

  it("budget épuisé : la défusion aboutit avec le résumé par gabarit, sans appel au modèle", async () => {
    await setLimit(await spent());
    const calls = fakeAi({ summary: 0.0002 });
    const from = await entryCount();
    const { res, tribune } = await split();
    expect(res.status).toBe(201);
    expect(calls).toEqual([]);
    expect(res.body.created.summary).toBe(
      new TemplateTextModel().summarize({ title: tribune.title, text: tribune.excerpt }),
    );
    expect(await entriesSince(from)).toEqual([]);
  });

  it("sans clé IA, rien n'est réservé ni compté", async () => {
    const from = await entryCount();
    const { res } = await split();
    expect(res.status).toBe(201);
    expect(await entriesSince(from)).toEqual([]);
  });
});
