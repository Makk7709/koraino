import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ApiErrorBody,
  CollectionRun,
  Paginated,
  Signal,
  SignalDetail,
  Source,
} from "@/lib/api/types";
import { setAdapters } from "@/server/adapters";
import {
  FRESHNESS_DAYS,
  googleNewsUrl,
  mapPerplexityResults,
  PERPLEXITY_MAX_RESULTS,
  perplexityRequest,
  RealCollector,
  type CollectResult,
  type RawItem,
} from "@/server/adapters/collector";
import { getRepository } from "@/server/store/memory";
import type { CompanyRecord, SourceRecord } from "@/server/store/records";
import { call, NOW, setup, teardown, USERS } from "./helpers";

const DAY = 86_400_000;
const KEYS = { LOVABLE_API_KEY: "cle-passerelle", PERPLEXITY_API_KEY: "cle-connexion" };

const company = {
  id: "co_kalray",
  name: "Kalray",
  aliases: [],
  domain: "kalray.eu",
  brand: { initials: "KA", bg: "#111", fg: "#fff" },
} as unknown as CompanyRecord;

const source = {
  id: "src_kalray_web",
  type: "recherche_web",
  label: "Kalray",
  url: "https://websearch.invalid/",
} as unknown as SourceRecord;

interface FeedItem {
  title: string;
  outlet: string;
  domain: string;
  daysAgo: number;
}

function rss(items: FeedItem[]): string {
  const body = items
    .map(
      (i, n) => `<item>
  <title>${i.title} - ${i.outlet}</title>
  <link>https://news.google.com/rss/articles/${n}</link>
  <pubDate>${new Date(NOW.getTime() - i.daysAgo * DAY).toUTCString()}</pubDate>
  <description>${i.title}</description>
  <source url="https://www.${i.domain}">${i.outlet}</source>
</item>`,
    )
    .join("\n");
  return `<?xml version="1.0"?><rss version="2.0"><channel>${body}</channel></rss>`;
}

const GOOGLE: FeedItem[] = [
  {
    title: "Kalray signe avec Openchip",
    outlet: "Boursier.com",
    domain: "boursier.com",
    daysAgo: 1,
  },
  {
    title: "Kalray présente ses résultats semestriels",
    outlet: "Les Echos",
    domain: "lesechos.fr",
    daysAgo: 20,
  },
  {
    title: "Kalray recrute à Montbonnot",
    outlet: "Le Dauphiné",
    domain: "ledauphine.com",
    daysAgo: 45,
  },
  {
    title: "Kalray au salon Embedded World",
    outlet: "Electronique",
    domain: "electronique.fr",
    daysAgo: 150,
  },
];

/** Répond au flux Google News (ou à une erreur Google) et, si fourni, à la passerelle Perplexity. */
function stubFetch(perplexity?: () => Response, google = () => new Response(rss(GOOGLE))) {
  const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://news.google.com/")) return google();
    if (url.includes("/perplexity/search") && perplexity) return perplexity();
    return new Response("introuvable", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function collectRaw(env: Record<string, string | undefined>) {
  return new RealCollector(env).collect({ source, company, attempt: 1, now: NOW, knownEvents: [] });
}

async function collect(env: Record<string, string | undefined>) {
  const result = await collectRaw(env);
  if (!result.ok) throw new Error(result.reason);
  return result;
}

const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY).toISOString().slice(0, 10);

const MUNICH = {
  title: "Kalray ouvre un bureau à Munich",
  url: "https://www.placegrenet.fr/kalray-munich",
  snippet: "La société grenobloise s'étend en Allemagne.",
  date: daysAgo(3),
};

afterEach(() => vi.unstubAllGlobals());

describe("collecte réelle : fraîcheur", () => {
  it(`écarte les publications datées de plus de ${FRESHNESS_DAYS} jours et trie par date`, async () => {
    stubFetch();
    const result = await collect({});
    expect(result.items.map((i) => i.title)).toEqual([
      "Kalray signe avec Openchip",
      "Kalray présente ses résultats semestriels",
    ]);
    expect(result.items.every((i) => i.via === "google_news")).toBe(true);
  });

  it("signale une recherche Perplexity non configurée sans bloquer Google News", async () => {
    const fetchMock = stubFetch();
    const result = await collect({ LOVABLE_API_KEY: "x" });
    expect(result.items).toHaveLength(2);
    expect(result.enrichment).toEqual({
      provider: "perplexity",
      status: "non_configure",
      received: 0,
      matched: 0,
      message: "Secret manquant : PERPLEXITY_API_KEY",
    });
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("perplexity"))).toBe(false);
  });
});

describe("collecte réelle : enrichissement Perplexity", () => {
  it("ajoute les actualités datées qui citent l'entreprise, sans doublon avec Google News", async () => {
    const fetchMock = stubFetch(() =>
      Response.json({
        results: [
          {
            title: "Kalray présente ses résultats semestriels | Les Echos",
            url: "https://www.lesechos.fr/kalray-resultats",
            snippet: "Kalray publie ses comptes.",
            date: daysAgo(20),
          },
          MUNICH,
          {
            title: "Kalray Labs : notre vision du calcul",
            url: "https://www.kalray.eu/labs",
            snippet: "Page de présentation de Kalray.",
            date: daysAgo(2),
          },
          {
            title: "Kalray - fiche entreprise",
            url: "https://www.annuaire-entreprises.fr/kalray",
            snippet: "Kalray, SIREN, dirigeants, chiffre d'affaires.",
            date: null,
          },
          {
            title: "Le marché des processeurs en 2026",
            url: "https://example.com/processeurs",
            snippet: "Panorama du secteur.",
            date: daysAgo(1),
          },
          {
            title: "Innovation - Le Dauphiné Libéré",
            url: "https://www.ledauphine.com/innovation",
            snippet: "Kalray, Soitec et les autres : toute l'innovation en Isère.",
            date: daysAgo(1),
          },
          {
            title: "Network Technology recent news | page 970 of 1107 | Light Reading",
            url: "https://www.lightreading.com/network-technology?page=970",
            snippet: "Kalray launches its new DPU…",
            date: daysAgo(2),
          },
        ],
      }),
    );
    const result = await collect(KEYS);

    // Les pages de rubrique et de pagination qui citent Kalray ne sont pas retenues.
    expect(result.enrichment).toEqual({
      provider: "perplexity",
      status: "ok",
      received: 7,
      matched: 2,
      message: null,
    });
    const fromPerplexity = result.items.filter((i) => i.via === "perplexity");
    expect(fromPerplexity.map((i) => i.url)).toEqual([MUNICH.url]);
    expect(fromPerplexity[0]!.publishedAt).toBe(new Date(daysAgo(3)).toISOString());
    expect(result.items.map((i) => i.title)).toEqual([
      "Kalray signe avec Openchip",
      "Kalray ouvre un bureau à Munich",
      "Kalray présente ses résultats semestriels",
    ]);

    const [, init] = fetchMock.mock.calls.find(([u]) => String(u).includes("perplexity"))!;
    const headers = init!.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer cle-passerelle");
    expect(headers["X-Connection-Api-Key"]).toBe("cle-connexion");
    expect(JSON.parse(String(init!.body))).toEqual({
      query: '"Kalray" actualité',
      max_results: PERPLEXITY_MAX_RESULTS,
      country: "FR",
      search_language_filter: ["fr", "en"],
      search_recency_filter: "month",
      search_domain_filter: ["-kalray.eu"],
    });
  });

  it("interroge Google News et Perplexity sur le nom courant et les alias", async () => {
    const alpao = {
      ...company,
      id: "co_alpao",
      name: "Bertin Alpao",
      aliases: ["Alpao", " alpao ", "ALPAO"],
      domain: "alpao.com",
    } as CompanyRecord;
    const fetchMock = stubFetch(() => Response.json({ results: [] }));
    const stale = { ...source, url: googleNewsUrl("Alpao SAS") } as SourceRecord;
    await new RealCollector(KEYS).collect({
      source: stale,
      company: alpao,
      attempt: 1,
      now: NOW,
      knownEvents: [],
    });
    const google = fetchMock.mock.calls
      .map(([u]) => String(u))
      .find((u) => u.includes("news.google"));
    expect(google).toBe(googleNewsUrl(["Bertin Alpao", "Alpao"]));
    expect(decodeURIComponent(google!)).toContain('q="Bertin Alpao" OR "Alpao"&');
    expect(perplexityRequest(alpao)).toMatchObject({
      query: '"Bertin Alpao" OR "Alpao" actualité',
    });
  });

  it("retient un résultat daté par sa dernière mise à jour et reconnaît le nom sans accents", () => {
    const société = { ...company, name: "Société Kalray", aliases: ["Kalray"] } as CompanyRecord;
    const items = mapPerplexityResults(
      [
        {
          title: "SOCIETE KALRAY accélère",
          url: "https://www.lesechos.fr/kalray-accelere",
          snippet: "Le groupe grenoblois…",
          date: null,
          last_updated: daysAgo(4),
        },
        {
          title: "Panorama des processeurs",
          url: "https://www.lesechos.fr/panorama",
          snippet: "Sans mention de l'entreprise.",
          date: daysAgo(1),
        },
        {
          title: "Kalray sans date",
          url: "https://www.usinenouvelle.com/kalray",
          snippet: "Kalray.",
        },
      ],
      société,
    );
    expect(items.map((i) => i.url)).toEqual(["https://www.lesechos.fr/kalray-accelere"]);
    expect(items[0]!.publishedAt).toBe(new Date(daysAgo(4)).toISOString());
  });

  it("ne relance pas Perplexity quand Google News est réessayé", async () => {
    let googleCalls = 0;
    const fetchMock = stubFetch(
      () => new Response("indisponible", { status: 503 }),
      () => {
        googleCalls += 1;
        return googleCalls === 1
          ? new Response("délai", { status: 503 })
          : new Response(rss(GOOGLE));
      },
    );
    const collector = new RealCollector(KEYS);
    const input = { source, company, now: NOW, knownEvents: [] };
    const first = await collector.collect({ ...input, attempt: 1 });
    expect(first).toMatchObject({ ok: false, code: "HTTP_503", transient: true });
    const second = await collector.collect({ ...input, attempt: 2 });
    expect(second.ok && second.items).toHaveLength(2);
    expect(second.ok && second.enrichment).toMatchObject({ status: "erreur" });
    const perplexityCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes("perplexity"));
    expect(perplexityCalls).toHaveLength(1);
    expect(googleCalls).toBe(2);
  });

  it("mène la collecte avec Perplexity quand Google News est indisponible", async () => {
    const unavailable = () => new Response("indisponible", { status: 503 });
    stubFetch(() => Response.json({ results: [MUNICH] }), unavailable);
    const result = await collect(KEYS);
    expect(result.items.map((i) => i.url)).toEqual([MUNICH.url]);
    expect(result.warning).toEqual({
      code: "HTTP_503",
      reason: "Google News : Réponse HTTP 503",
    });

    stubFetch(undefined, unavailable);
    const failed = await collectRaw({});
    expect(failed).toMatchObject({ ok: false, code: "HTTP_503", transient: true });
  });

  it("consigne l'erreur de la passerelle sans exposer les secrets", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch(() => new Response('{"error":"insufficient credits"}', { status: 402 }));
    const result = await collect(KEYS);
    expect(result.items).toHaveLength(2);
    expect(result.enrichment).toMatchObject({ status: "erreur", received: 0, matched: 0 });
    expect(result.enrichment!.message).toBe('HTTP 402 : {"error":"insufficient credits"}');
    expect(JSON.stringify(result)).not.toContain("cle-");
  });
});

describe("collecte : traçabilité et tri", () => {
  beforeEach(() => setup());
  afterEach(teardown);

  const outlet = (name: string, domain: string) => ({
    name,
    domain,
    brand: { initials: name[0]!, bg: "#111", fg: "#fff" },
  });

  async function pasqalSource(): Promise<Source> {
    const res = await call<Source[]>("GET", "/sources?companyId=co_pasqal");
    return res.body.find((s) => s.type === "communiques")!;
  }

  function stubCollector(result: CollectResult) {
    setAdapters({ collector: { name: "stub", collect: () => result } });
  }

  it("enregistre la provenance des observations et le bilan Perplexity de l'exécution", async () => {
    const items: RawItem[] = [
      {
        url: "https://www.placegrenet.fr/pasqal-ouvre-un-laboratoire-a-meylan",
        title: "Pasqal ouvre un laboratoire de recherche à Meylan",
        html: "<p>Pasqal ouvre un laboratoire de recherche à Meylan avec 30 chercheurs.</p>",
        outlet: outlet("placegrenet.fr", "placegrenet.fr"),
        publishedAt: new Date(NOW.getTime() - 2 * DAY).toISOString(),
        eventDate: null,
        via: "perplexity",
      },
    ];
    stubCollector({
      ok: true,
      items,
      enrichment: { provider: "perplexity", status: "ok", received: 4, matched: 1, message: null },
      warning: { code: "HTTP_503", reason: "Google News : Réponse HTTP 503" },
    });
    const src = await pasqalSource();
    const run = await call<CollectionRun>("POST", `/sources/${src.id}/collect`);
    expect(run.body).toMatchObject({
      status: "succes",
      newObservations: 1,
      errorCode: "HTTP_503",
      errorMessage: "Google News : Réponse HTTP 503",
      enrichment: { status: "ok", received: 4, matched: 1, added: 1 },
    });
    expect((await pasqalSource()).access).toBe("ok");

    const list = await call<Paginated<Signal>>("GET", "/signals?q=laboratoire&status=tous");
    const detail = await call<SignalDetail>("GET", `/signals/${list.body.items[0]!.id}`);
    expect(detail.body.observations.map((o) => o.via)).toEqual(["perplexity"]);
  });

  it("trie « récent » par date de publication, pas par date de collecte", async () => {
    stubCollector({
      ok: true,
      items: [
        {
          url: "https://www.lesechos.fr/pasqal-ancien-contrat",
          title: "Pasqal décroche un contrat avec un industriel allemand",
          html: "<p>Pasqal décroche un contrat avec un industriel allemand pour ses processeurs.</p>",
          outlet: outlet("Les Echos", "lesechos.fr"),
          publishedAt: new Date(NOW.getTime() - 25 * DAY).toISOString(),
          eventDate: null,
          via: "google_news",
        },
      ],
    });
    await call("POST", `/sources/${(await pasqalSource()).id}/collect`);

    const recent = await call<Paginated<Signal>>(
      "GET",
      "/signals?status=tous&sort=recent&limit=200",
    );
    const ids = recent.body.items.map((s) => s.id);
    expect(ids[0]).toBe("sig_pasqal");
    const late = recent.body.items.find((s) => s.title.startsWith("Pasqal décroche"))!;
    expect(ids.indexOf(late.id)).toBeGreaterThan(4);
    const times = recent.body.items.map((s) =>
      Date.parse(s.publishedAt ?? s.eventDate ?? s.collectedAt),
    );
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("retient jusqu'à 5 publications nouvelles par exécution, les connues ne comptant pas", async () => {
    const topics = [
      "recrute 40 ingénieurs",
      "ouvre un site à Lyon",
      "signe avec Airbus",
      "dépose un brevet",
      "rejoint un consortium",
      "lance une nouvelle gamme",
      "s'implante au Canada",
    ];
    const items: RawItem[] = topics.map((t, n) => ({
      url: `https://www.placegrenet.fr/pasqal-${n}`,
      title: `Pasqal ${t}`,
      html: `<p>Pasqal ${t} pour accompagner sa croissance.</p>`,
      outlet: outlet("Place Gre'net", "placegrenet.fr"),
      publishedAt: new Date(NOW.getTime() - (n + 1) * DAY).toISOString(),
      eventDate: null,
    }));
    stubCollector({ ok: true, items });
    const src = await pasqalSource();
    const observationUnits = async () =>
      (await (await getRepository()).usage.list())
        .filter((u) => u.kind === "observation" && u.label === `Observations ${src.label}`)
        .reduce((sum, u) => sum + u.units, 0);
    const before = await observationUnits();

    const runs = [];
    for (let i = 0; i < 3; i++) {
      runs.push((await call<CollectionRun>("POST", `/sources/${src.id}/collect`)).body);
    }
    expect(runs.map((r) => [r.status, r.newObservations])).toEqual([
      ["succes", 5],
      ["succes", 2],
      ["succes_sans_actualite", 0],
    ]);
    expect((await observationUnits()) - before).toBe(7);
  });

  it("refuse une collecte pendant qu'une autre est en cours", async () => {
    const repo = await getRepository();
    const token = await repo.acquireLock("collecte", 60_000);
    const busy = await call<ApiErrorBody>("POST", "/collect");
    expect(busy.status).toBe(409);
    expect(busy.body.error.code).toBe("collection_in_progress");
    const one = await call<ApiErrorBody>("POST", `/sources/${(await pasqalSource()).id}/collect`);
    expect(one.status).toBe(409);

    await repo.releaseLock("collecte", token!);
    stubCollector({ ok: true, items: [] });
    expect((await call("POST", `/sources/${(await pasqalSource()).id}/collect`)).status).toBe(200);
    expect(await repo.acquireLock("collecte", 60_000)).not.toBeNull();
  });
});

describe("collecte réelle : flux des entreprises", () => {
  const ownFeed = { ...source, type: "rss", url: "https://www.kalray.eu/feed/" } as SourceRecord;
  const ownSite = {
    ...source,
    type: "site_officiel",
    url: "https://www.kalray.eu/",
  } as SourceRecord;

  function stubPage(body: string) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body)),
    );
  }

  it("écarte les éléments sans date et ceux datés dans le futur (agendas)", async () => {
    const date = (d: number) => new Date(NOW.getTime() - d * DAY).toUTCString();
    stubPage(`<rss><channel>
      <item><title>Kalray publie ses résultats</title><link>https://www.kalray.eu/a</link><pubDate>${date(2)}</pubDate></item>
      <item><title>Kalray : qui sommes-nous</title><link>https://www.kalray.eu/b</link></item>
      <item><title>Séminaire Kalray de mars</title><link>https://www.kalray.eu/c</link><pubDate>${date(-40)}</pubDate></item>
    </channel></rss>`);
    const result = await new RealCollector({}).collect({
      source: ownFeed,
      company,
      attempt: 1,
      now: NOW,
      knownEvents: [],
    });
    expect(result.ok && result.items.map((i) => i.url)).toEqual(["https://www.kalray.eu/a"]);
  });

  it("essaie les adresses habituelles du flux quand la page n'en annonce aucun", async () => {
    const date = new Date(NOW.getTime() - 2 * DAY).toUTCString();
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        asked.push(url);
        if (url === "https://www.kalray.eu/feed/")
          return new Response(
            `<rss><channel><item><title>Kalray publie ses résultats</title><link>https://www.kalray.eu/a</link><pubDate>${date}</pubDate></item></channel></rss>`,
          );
        if (url === "https://www.kalray.eu/")
          return new Response("<html><body>Bienvenue</body></html>");
        return new Response("introuvable", { status: 404 });
      }),
    );
    const result = await new RealCollector({}).collect({
      source: ownSite,
      company,
      attempt: 1,
      now: NOW,
      knownEvents: [],
    });
    expect(result.ok && result.items.map((i) => i.url)).toEqual(["https://www.kalray.eu/a"]);
    expect(asked).toEqual(["https://www.kalray.eu/", "https://www.kalray.eu/feed/"]);
  });

  it("met en échec définitif une page sans flux, même aux adresses habituelles", async () => {
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        asked.push(String(input));
        return new Response(
          "<html><head><title>Kalray</title></head><body>Bienvenue</body></html>",
        );
      }),
    );
    const result = await new RealCollector({}).collect({
      source: ownSite,
      company,
      attempt: 1,
      now: NOW,
      knownEvents: [],
    });
    expect(result).toMatchObject({ ok: false, code: "NO_FEED", transient: false });
    expect(result.ok === false && result.reason).toContain("/feed/");
    expect(asked).toEqual([
      "https://www.kalray.eu/",
      "https://www.kalray.eu/feed/",
      "https://www.kalray.eu/rss",
      "https://www.kalray.eu/feed.xml",
      "https://www.kalray.eu/rss.xml",
    ]);
  });

  it("refuse un flux RSS découvert dans le HTML qui pointe vers une adresse interne", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);

      if (url === ownSite.url) {
        return new Response(
          `<html>
            <head>
              <link
                rel="alternate"
                type="application/rss+xml"
                href="http://127.0.0.1/secret"
              />
            </head>
            <body>Kalray</body>
          </html>`,
          {
            status: 200,
            headers: { "content-type": "text/html" },
          },
        );
      }

      throw new Error(`Requête inattendue : ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await new RealCollector({}).collect({
      source: ownSite,
      company,
      attempt: 1,
      now: NOW,
      knownEvents: [],
    });

    // La page HTML est récupérée, mais aucune requête vers le flux interdit
    // ne doit être effectuée.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(ownSite.url);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("127.0.0.1"))).toBe(false);
    expect(result).toMatchObject({ ok: false, code: "URL_REFUSED" });
  });

  it("intégration : HTML → feed.xml → item daté (2 fetch)", async () => {
    const siteUrl = "https://www.kalray.eu/";
    const feedUrl = "https://www.kalray.eu/feed.xml";
    const date = (d: number) => new Date(NOW.getTime() - d * DAY).toUTCString();

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === siteUrl) {
        return new Response(
          `<html><head>
            <link rel="alternate" type="application/rss+xml" href="/feed.xml" />
          </head><body></body></html>`,
          { status: 200, headers: { "content-type": "text/html" } },
        );
      }
      if (url === feedUrl) {
        return new Response(
          `<?xml version="1.0"?><rss><channel>
            <item>
              <title>Kalray publie</title>
              <link>https://www.kalray.eu/a</link>
              <pubDate>${date(2)}</pubDate>
            </item>
          </channel></rss>`,
          { status: 200, headers: { "content-type": "application/rss+xml" } },
        );
      }
      throw new Error(`URL inattendue : ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new RealCollector({}).collect({
      source: ownSite,
      company,
      attempt: 1,
      now: NOW,
      knownEvents: [],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.ok && result.items[0]?.url).toBe("https://www.kalray.eu/a");
  });

  it("intégration : 2 fetch OK puis refus avant 3ème vers interne (redirect)", async () => {
    const siteUrl = "https://www.kalray.eu/";
    const feedUrl = "https://www.kalray.eu/feed.xml";
    const feedFinal = "https://www.kalray.eu/feed-final";

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);

      if (url === siteUrl) {
        return new Response(
          `<html><head>
            <link rel="alternate" type="application/rss+xml" href="/feed.xml" />
          </head></html>`,
          { status: 200 },
        );
      }
      if (url === feedUrl) {
        return new Response(null, {
          status: 302,
          headers: { Location: "/feed-final" },
        });
      }
      if (url === feedFinal) {
        return new Response(null, {
          status: 302,
          headers: { Location: "http://127.0.0.1/secret" },
        });
      }
      throw new Error(`Requête interdite ou inattendue : ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new RealCollector({}).collect({
      source: ownSite,
      company,
      attempt: 1,
      now: NOW,
      knownEvents: [],
    });

    // HTML + feed.xml + feed-final ; jamais 127.0.0.1
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map(([u]) => String(u))).toEqual([siteUrl, feedUrl, feedFinal]);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("127.0.0.1"))).toBe(false);
    expect(result).toMatchObject({ ok: false, code: "URL_REFUSED" });
  });


  
});

describe("C01 · intégration collecte (exercice 4b)", () => {
  beforeEach(() => {
    setup();
    setAdapters({ collector: new RealCollector({}) });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    teardown();
  });
  async function pasqalCommuniques(): Promise<Source> {
    const res = await call<Source[]>("GET", "/sources?companyId=co_pasqal");
    const source = res.body.find((s) => s.type === "communiques");
    if (!source) throw new Error("source communiqués Pasqal introuvable dans le seed");
    return source;
  }
  it("un refus de sécurité n'est pas réessayé (HOST_MISMATCH)", async () => {
    const source = await pasqalCommuniques();
    const fetchMock = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: "https://www.autre-site.fr/actualites" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const run = await call<CollectionRun>("POST", `/sources/${source.id}/collect`, {
      user: USERS.admin,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(run.body).toMatchObject({
      status: "echec",
      errorCode: "HOST_MISMATCH",
    });
    const sources = await call<Source[]>("GET", "/sources?companyId=co_pasqal");
    expect(sources.body.find((s) => s.id === source.id)).toMatchObject({
      access: "erreur",
      failureCode: "HOST_MISMATCH",
      attempts: 1,
    });
  });
  it("un flux absent n'est pas réessayé (NO_FEED)", async () => {
    const sources = await call<Source[]>(
      "GET",
      "/sources?companyId=co_pasqal",
    );
  
    const source = sources.body.find(
      (s) => s.type === "site_officiel",
    );
  
    if (!source) {
      throw new Error("Source site officiel Pasqal introuvable");
    }
  
    const fetchMock = vi.fn(async () =>
      new Response(
        "<html><head><title>Pasqal</title></head><body>Bienvenue</body></html>",
        {
          status: 200,
          headers: { "content-type": "text/html" },
        },
      ),
    );
  
    vi.stubGlobal("fetch", fetchMock);
  
    const run = await call<CollectionRun>(
      "POST",
      `/sources/${source.id}/collect`,
      { user: USERS.admin },
    );
  
    expect(run.body).toMatchObject({
      status: "echec",
      errorCode: "NO_FEED",
    });
  
    const updatedSources = await call<Source[]>(
      "GET",
      "/sources?companyId=co_pasqal",
    );
  
    expect(
      updatedSources.body.find((s) => s.id === source.id),
    ).toMatchObject({
      access: "erreur",
      failureCode: "NO_FEED",
      attempts: 1,
    });
  });

  it("un délai de lecture est stocké en TIMEOUT (4c)", async () => {
    setAdapters({
      collector: new RealCollector({}, 50),
    });
    const source = await pasqalCommuniques();

    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const signal = init?.signal;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (signal?.aborted) {
            controller.error(signal.reason ?? new DOMException("Timeout", "TimeoutError"));
            return;
          }
          signal?.addEventListener(
            "abort",
            () => {
              controller.error(signal.reason ?? new DOMException("Timeout", "TimeoutError"));
            },
            { once: true },
          );
        },
      });
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const run = await call<CollectionRun>("POST", `/sources/${source.id}/collect`, {
      user: USERS.admin,
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(run.body).toMatchObject({
      status: "echec",
      errorCode: "TIMEOUT",
    });

    const sources = await call<Source[]>("GET", "/sources?companyId=co_pasqal");
    const updated = sources.body.find((s) => s.id === source.id)!;
    expect(updated).toMatchObject({
      access: "erreur",
      failureCode: "TIMEOUT",
      failureReason: "Délai de réponse dépassé",
      attempts: 3,
    });
    expect(updated.failureCode).not.toBe("23");
  });
  it("réessaie après une TypeError réseau sans code (C01-T1)", async () => {
    const source = await pasqalCommuniques();
  
    let fetchCalls = 0;
  
    const fetchMock = vi.fn(async () => {
      fetchCalls += 1;
  
      if (fetchCalls === 1) {
        throw new TypeError("Failed to fetch");
      }
  
      return new Response(
        `<?xml version="1.0"?>
        <rss>
          <channel>
            <item>
              <title>Pasqal publie une actualité</title>
              <link>https://www.pasqal.com/actualite</link>
              <pubDate>${new Date(NOW.getTime() - DAY).toUTCString()}</pubDate>
            </item>
          </channel>
        </rss>`,
        {
          status: 200,
          headers: { "content-type": "application/rss+xml" },
        },
      );
    });
  
    vi.stubGlobal("fetch", fetchMock);
  
    const run = await call<CollectionRun>(
      "POST",
      `/sources/${source.id}/collect`,
      { user: USERS.admin },
    );
  
    expect(fetchMock).toHaveBeenCalledTimes(2);
  
    expect(run.body).toMatchObject({
      status: "succes",
      newObservations: 1,
    });
  
    const sources = await call<Source[]>(
      "GET",
      "/sources?companyId=co_pasqal",
    );
  
    expect(
      sources.body.find((s) => s.id === source.id),
    ).toMatchObject({
      access: "ok",
      attempts: 0,
    });
  });

  it("arrête les retries après MAX_ATTEMPTS (C01-02)", async () => {
    const source = await pasqalCommuniques();
  
    const fetchMock = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
  
    vi.stubGlobal("fetch", fetchMock);
  
    const run = await call<CollectionRun>(
      "POST",
      `/sources/${source.id}/collect`,
      { user: USERS.admin },
    );
  
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(run.body).toMatchObject({
      status: "echec",
      errorCode: "NETWORK",
    });
  
    const sources = await call<Source[]>(
      "GET",
      "/sources?companyId=co_pasqal",
    );
  
    expect(sources.body.find((s) => s.id === source.id))
      .toMatchObject({
        access: "erreur",
        failureCode: "NETWORK",
        attempts: 3,
      });
  });
  

});
