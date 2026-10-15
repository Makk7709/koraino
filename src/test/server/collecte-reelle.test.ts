import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CollectionRun, Paginated, Signal, SignalDetail, Source } from "@/lib/api/types";
import { setAdapters } from "@/server/adapters";
import {
  FRESHNESS_DAYS,
  RealCollector,
  type CollectResult,
  type RawItem,
} from "@/server/adapters/collector";
import type { CompanyRecord, SourceRecord } from "@/server/store/records";
import { call, NOW, setup, teardown } from "./helpers";

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
        ],
      }),
    );
    const result = await collect(KEYS);

    expect(result.enrichment).toEqual({
      provider: "perplexity",
      status: "ok",
      received: 5,
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
    expect(JSON.parse(String(init!.body))).toMatchObject({
      search_recency_filter: "month",
    });
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
});
