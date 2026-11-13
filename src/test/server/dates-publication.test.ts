/**
 * Dates de publication.
 *
 * Google News fournit une date d'indexation (`pubDate`). La date originale est sur la page
 * de l'éditeur, connue seulement une fois la redirection résolue, dans le service de collecte,
 * après `RealCollector`. Ces scénarios passent par `POST /sources/:id/collect`.
 * Le collecteur RSS ne télécharge pas chaque page.
 *
 * Politique : un article Google News sans date originale vérifiable — absente, invalide,
 * page en erreur ou redirection — n'est pas ingéré. Risque documenté : faux négatifs
 * (article réellement récent sans `datePublished`, `article:published_time` ni `uploadDate`,
 * ou site éditeur indisponible). Aucun champ métier nouveau.
 *
 * Un flux RSS/Atom de l'éditeur reste daté par son `pubDate`, sans second fetch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CollectionRun, Source } from "@/lib/api/types";
import { setAdapters } from "@/server/adapters";
import { GoogleNewsLinkResolver } from "@/server/adapters/google-news";
import {
  FRESHNESS_DAYS,
  PERPLEXITY_MAX_RESULTS,
  RealCollector,
  type CollectResult,
} from "@/server/adapters/collector";
import { validateSourceUrl } from "@/server/domain/security";
import {
  GOOGLE_NEWS_DATE_BUDGET_MS,
  MAX_GOOGLE_NEWS_CHECKS,
  MAX_ITEMS,
} from "@/server/services/collection";
import { MAX_PUBLISHER_HTML_BYTES } from "@/server/services/publisher-page";
import { getRepository } from "@/server/store/memory";
import type { CompanyRecord, ObservationRecord, SourceRecord } from "@/server/store/records";
import { call, NOW, setup, teardown } from "./helpers";

const DAY = 86_400_000;
const KEYS = { LOVABLE_API_KEY: "cle-passerelle", PERPLEXITY_API_KEY: "cle-connexion" };

const company = {
  id: "co_pasqal",
  name: "Pasqal",
  aliases: ["Pasqal SAS"],
  domain: "pasqal.com",
  brand: { initials: "PQ", bg: "#111", fg: "#fff" },
} as unknown as CompanyRecord;

const rssSource = {
  id: "src_pasqal_rss",
  type: "rss",
  label: "Flux officiel Pasqal",
  url: "https://www.pasqal.com/feed/",
} as unknown as SourceRecord;

const isoAgo = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

/** Date d'indexation Google News, distincte des dates originales des fixtures. */
const INDEXED = isoAgo(1);
const ORIGINAL_2019 = "2019-03-15T14:00:00.000Z";

const VIDEO_2019 = {
  title: "KORA-DATES Pasqal : la vidéo fondatrice du processeur quantique",
  url: "https://www.youtube.com/watch?v=kora-dates-pasqal-2019",
  original: ORIGINAL_2019,
};
const RECENT = {
  title: "KORA-DATES Pasqal ouvre un laboratoire de recherche à Grenoble",
  url: "https://www.placegrenet.fr/pasqal-laboratoire-kora-dates",
  original: isoAgo(6),
};
const STALE = {
  title: "KORA-DATES Pasqal annonce un partenariat industriel européen",
  url: "https://www.lesechos.fr/pasqal-partenariat-kora-dates",
  original: isoAgo(60),
};
const JSON_LD = {
  title: "KORA-DATES Pasqal recrute trente ingénieurs en Isère",
  url: "https://www.usinenouvelle.com/pasqal-recrute-kora-dates",
  original: isoAgo(2),
  modified: hoursAgo(3),
};
const META = {
  title: "KORA-DATES Pasqal signe un contrat avec un industriel français",
  url: "https://www.latribune.fr/pasqal-contrat-kora-dates",
  original: isoAgo(4),
};
const MODIFIED = {
  title: "KORA-DATES Pasqal met à jour sa page de présentation",
  url: "https://www.ledauphine.com/pasqal-maj-kora-dates",
  published: isoAgo(60),
  modified: INDEXED,
};
const CONTRADICTED = {
  title: "KORA-DATES Pasqal dépose un brevet sur ses qubits",
  url: "https://www.lemondeinformatique.fr/pasqal-brevet-kora-dates",
  original: isoAgo(5),
};
const UNKNOWN = {
  title: "KORA-DATES Pasqal cité dans une revue de presse sans date éditeur",
  url: "https://www.example-presse.fr/pasqal-sans-date-kora-dates",
};
const TIMEOUT_ARTICLE = {
  title: "KORA-DATES Pasqal évoqué sur un site éditeur en délai dépassé",
  url: "https://www.editeur-timeout.example/pasqal-kora-dates",
};
const HTTP_500 = {
  title: "KORA-DATES Pasqal évoqué sur un site éditeur en erreur HTTP",
  url: "https://www.editeur-500.example/pasqal-kora-dates",
};
const SIBLING = {
  title: "KORA-DATES Pasqal confirme un contrat de recherche à Grenoble",
  url: "https://www.placegrenet.fr/pasqal-contrat-recherche-kora-dates",
  original: isoAgo(7),
};
const UPLOAD = {
  title: "KORA-DATES Pasqal publie une vidéo de démonstration du processeur",
  url: "https://www.youtube.com/watch?v=kora-dates-pasqal-upload",
  uploadDate: isoAgo(9),
};
const HALL = {
  title: "KORA-DATES Pasqal inaugure une salle de calcul à Grenoble",
  url: "https://www.placegrenet.fr/pasqal-salle-calcul-kora-dates",
  original: isoAgo(8),
};

const METADATA = "http://169.254.169.254/latest/meta-data";
const LOCALHOST = "http://localhost/admin";
const IPV6_LOOPBACK = "http://[::1]/admin";
const LAN = "http://192.168.1.20/rss";
const LOOPBACK = "http://127.0.0.1/admin";
const REDIRECT_PRIVATE = "http://10.0.0.8/secret";
const REDIRECT_PUBLIC = "https://www.lesechos.fr/pasqal-redirection-kora-dates";
const REDIRECT_TITLE = "KORA-DATES Pasqal page qui redirige vers une adresse privée";

function gnRedirect(index: number): string {
  return `https://news.google.com/rss/articles/kora${index}`;
}

interface FeedArticle {
  title: string;
  url: string;
  outlet: string;
  domain: string;
  /** Date annoncée par Google News (indexation), pas la publication originale. */
  gnPublishedAt: string;
}

function feed(
  article: { title: string; url: string },
  gnPublishedAt: string,
  outlet = "Place Gre'net",
  domain = "placegrenet.fr",
): FeedArticle {
  return { title: article.title, url: article.url, outlet, domain, gnPublishedAt };
}

function googleNewsRss(items: FeedArticle[], asRedirect = true): string {
  const body = items
    .map((item, index) => {
      const direct = !asRedirect || item.url.startsWith("http://");
      const link = direct ? item.url : gnRedirect(index);
      return `<item>
  <title>${item.title} - ${item.outlet}</title>
  <link>${link}</link>
  <pubDate>${new Date(item.gnPublishedAt).toUTCString()}</pubDate>
  <description>${item.title}</description>
  <source url="https://www.${item.domain}">${item.outlet}</source>
</item>`;
    })
    .join("\n");
  return `<?xml version="1.0"?><rss version="2.0"><channel>${body}</channel></rss>`;
}

function officialRss(title: string, url: string, publishedAt: string): string {
  return `<?xml version="1.0"?><rss version="2.0"><channel>
  <item>
    <title>${title}</title>
    <link>${url}</link>
    <pubDate>${new Date(publishedAt).toUTCString()}</pubDate>
    <description>${title} — communiqué officiel de Pasqal.</description>
  </item>
</channel></rss>`;
}

function articleHtml(opts: {
  title: string;
  datePublished?: string;
  dateModified?: string;
  uploadDate?: string;
  /** false : aucun JSON-LD ; la date n'est alors que dans `article:published_time`. */
  jsonLd?: boolean;
  publishedTime?: boolean;
  video?: boolean;
  /** Dates présentes mais illisibles (`hier matin`, `pas-une-date`). */
  invalid?: boolean;
}): string {
  const published = opts.invalid ? "hier matin" : opts.datePublished;
  const upload = opts.invalid ? "hier matin" : opts.uploadDate;
  const video =
    opts.video === true || (opts.uploadDate !== undefined && opts.datePublished === undefined);
  const ld: Record<string, string> = {
    "@context": "https://schema.org",
    "@type": video ? "VideoObject" : "NewsArticle",
    headline: opts.title,
  };
  if (published !== undefined) ld["datePublished"] = published;
  if (opts.dateModified !== undefined) ld["dateModified"] = opts.dateModified;
  if (upload !== undefined) ld["uploadDate"] = upload;
  const jsonLd =
    opts.jsonLd === false
      ? ""
      : `<script type="application/ld+json">${JSON.stringify(ld)}</script>`;
  const publishedMeta =
    opts.publishedTime && opts.datePublished !== undefined
      ? `<meta property="article:published_time" content="${opts.invalid ? "pas-une-date" : opts.datePublished}" />`
      : "";
  const modifiedMeta =
    opts.dateModified !== undefined
      ? `<meta property="article:modified_time" content="${opts.dateModified}" />`
      : "";
  return `<!DOCTYPE html><html><head><title>${opts.title}</title>${publishedMeta}${modifiedMeta}${jsonLd}</head>
<body><article><h1>${opts.title}</h1><p>${opts.title}. Pasqal poursuit son développement à Grenoble.</p></article></body></html>`;
}

function stubNetwork(opts: {
  rss?: string;
  pages?: Record<string, string | (() => Response)>;
  perplexity?: () => Response;
}) {
  const asked: string[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    asked.push(url);
    if (url.includes("/perplexity/search") && opts.perplexity) return opts.perplexity();
    if (url.includes("news.google.com/rss/search")) {
      return new Response(opts.rss ?? "<rss><channel></channel></rss>");
    }
    if (opts.rss && url === rssSource.url) return new Response(opts.rss);
    const page = opts.pages?.[url];
    if (typeof page === "function") return page();
    if (typeof page === "string") {
      return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    return new Response("introuvable", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, asked };
}

function fetchCount(asked: string[], url: string): number {
  return asked.filter((entry) => entry === url).length;
}

function assertNoReservedFetch(asked: string[]) {
  for (const raw of asked) expect(validateSourceUrl(raw).ok, raw).toBe(true);
}

function seen(created: ObservationRecord[]) {
  return created
    .map((observation) => ({
      title: observation.title,
      url: observation.url,
      via: observation.via ?? null,
      publishedAt: observation.publishedAt,
    }))
    .sort((a, b) => a.title.localeCompare(b.title, "fr"));
}

interface PipelineOptions {
  articles: FeedArticle[];
  pages?: Record<string, string | (() => Response)>;
  /** Remplace la correspondance redirection Google News → URL d'article. */
  links?: Record<string, string | null>;
  /** false : le flux porte déjà l'URL de l'éditeur, pas une redirection. */
  asRedirect?: boolean;
  onResolve?: (url: string) => void;
}

function installPipeline(opts: PipelineOptions) {
  const linkMap: Record<string, string | null> =
    opts.links ??
    Object.fromEntries(opts.articles.map((article, index) => [gnRedirect(index), article.url]));
  const resolved: string[] = [];
  const network = stubNetwork({
    rss: googleNewsRss(opts.articles, opts.asRedirect !== false),
    ...(opts.pages ? { pages: opts.pages } : {}),
  });
  setAdapters({
    collector: new RealCollector({}),
    links: {
      name: "liens-dates-test",
      async resolve(url: string): Promise<string | null> {
        resolved.push(url);
        opts.onResolve?.(url);
        return linkMap[url] ?? null;
      },
    },
  });
  return { ...network, resolved };
}

async function runGoogle(opts: PipelineOptions) {
  const net = installPipeline(opts);
  const sources = await call<Source[]>("GET", "/sources?companyId=co_pasqal");
  const source = sources.body.find((item) => item.type === "recherche_web");
  expect(source, "source recherche web Pasqal").toBeDefined();
  const run = await call<CollectionRun>("POST", `/sources/${source!.id}/collect`);
  const created = (await (await getRepository()).observations.list()).filter((observation) =>
    observation.title.includes("KORA-DATES"),
  );
  return { ...net, run, created };
}

function expectOk(result: CollectResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result;
}

afterEach(() => vi.unstubAllGlobals());

describe("dates de publication : mock réseau", () => {
  it("enregistre chaque URL et sert le HTML simulé, sans joindre un hôte réel", async () => {
    const html = articleHtml({ title: RECENT.title, datePublished: RECENT.original });
    const { asked } = stubNetwork({ pages: { [RECENT.url]: html } });
    const page = await fetch(RECENT.url);
    const body = await page.text();
    expect(page.status).toBe(200);
    expect(body).toContain(RECENT.original);
    expect(body).toContain("datePublished");
    const blocked = await fetch(METADATA);
    expect(blocked.status).toBe(404);
    expect(asked).toEqual([RECENT.url, METADATA]);
  });
});

describe("dates de publication : flux RSS officiel", () => {
  const title = "KORA-DATES Pasqal publie ses résultats semestriels";
  const url = "https://www.pasqal.com/fr/actualites/resultats-kora-dates";

  async function collectRss(publishedAt: string) {
    const network = stubNetwork({
      rss: officialRss(title, url, publishedAt),
      pages: { [url]: articleHtml({ title, datePublished: publishedAt }) },
    });
    const result = await new RealCollector({}).collect({
      source: rssSource,
      company,
      attempt: 1,
      now: NOW,
      knownEvents: [],
    });
    return { ...network, result: expectOk(result) };
  }

  it("conserve un article daté sans télécharger sa page", async () => {
    const { asked, result } = await collectRss(RECENT.original);
    expect(asked).toEqual([rssSource.url]);
    expect(fetchCount(asked, url)).toBe(0);
    expect(result.items).toEqual([
      expect.objectContaining({
        url,
        title,
        via: "flux",
        publishedAt: RECENT.original,
      }),
    ]);
  });

  it("écarte un article de plus de 30 jours sans télécharger sa page", async () => {
    expect(NOW.getTime() - Date.parse(STALE.original)).toBeGreaterThan(FRESHNESS_DAYS * DAY);
    const { asked, result } = await collectRss(STALE.original);
    expect(result.items).toEqual([]);
    expect(asked).toEqual([rssSource.url]);
    expect(fetchCount(asked, url)).toBe(0);
  });
});

describe("dates de publication : enrichissement Perplexity", () => {
  it("reste intact : résultats datés, hors page de rubrique, sans doublon de titre", async () => {
    const webSource = {
      id: "src_pasqal_web",
      type: "recherche_web",
      label: "Pasqal",
      url: "https://websearch.invalid/",
    } as unknown as SourceRecord;
    const munich = {
      title: "KORA-DATES Pasqal ouvre un bureau à Munich",
      url: "https://www.placegrenet.fr/pasqal-munich-kora-dates",
      snippet: "Pasqal s'étend en Allemagne.",
      date: isoAgo(3).slice(0, 10),
    };
    stubNetwork({
      rss: googleNewsRss([feed(RECENT, INDEXED)], false),
      pages: {
        [RECENT.url]: articleHtml({ title: RECENT.title, datePublished: RECENT.original }),
      },
      perplexity: () =>
        Response.json({
          results: [
            munich,
            {
              title: "Innovation - Le Dauphiné Libéré",
              url: "https://www.ledauphine.com/innovation",
              snippet: "Pasqal et les autres : toute l'innovation en Isère.",
              date: isoAgo(1).slice(0, 10),
            },
          ],
        }),
    });
    const result = expectOk(
      await new RealCollector(KEYS).collect({
        source: webSource,
        company,
        attempt: 1,
        now: NOW,
        knownEvents: [],
      }),
    );
    expect(result.enrichment).toEqual({
      provider: "perplexity",
      status: "ok",
      received: 2,
      matched: 1,
      message: null,
    });
    const extra = result.items.filter((item) => item.via === "perplexity");
    expect(extra.map((item) => item.url)).toEqual([munich.url]);
    expect(extra[0]!.publishedAt).toBe(new Date(munich.date).toISOString());
    expect(result.items.map((item) => item.title)).toContain(RECENT.title);
    expect(PERPLEXITY_MAX_RESULTS).toBe(10);
  });
});

describe("dates de publication : pipeline Google News", () => {
  beforeEach(() => setup());
  afterEach(teardown);

  it("1 — une vidéo de 2019 (datePublished) réindexée ne crée pas d'observation", async () => {
    expect(Date.parse(VIDEO_2019.original)).toBeLessThan(NOW.getTime() - FRESHNESS_DAYS * DAY);
    const { asked, run, created } = await runGoogle({
      articles: [feed(VIDEO_2019, INDEXED, "YouTube", "youtube.com")],
      pages: {
        [VIDEO_2019.url]: articleHtml({
          title: VIDEO_2019.title,
          datePublished: VIDEO_2019.original,
          video: true,
        }),
      },
    });
    expect({
      consulted: fetchCount(asked, VIDEO_2019.url),
      http: run.status,
      status: run.body.status,
      newObservations: run.body.newObservations,
      observations: seen(created),
    }).toEqual({
      consulted: 1,
      http: 200,
      status: "succes_sans_actualite",
      newObservations: 0,
      observations: [],
    });
    assertNoReservedFetch(asked);
  });

  it("2 — un article récent est ingéré avec sa date originale, pas celle de Google News", async () => {
    expect(RECENT.original).not.toBe(INDEXED);
    expect(NOW.getTime() - Date.parse(RECENT.original)).toBeLessThan(FRESHNESS_DAYS * DAY);
    const { asked, run, created } = await runGoogle({
      articles: [feed(RECENT, INDEXED)],
      pages: {
        [RECENT.url]: articleHtml({ title: RECENT.title, datePublished: RECENT.original }),
      },
    });
    expect({
      consulted: fetchCount(asked, RECENT.url),
      http: run.status,
      status: run.body.status,
      newObservations: run.body.newObservations,
      observations: seen(created),
    }).toEqual({
      consulted: 1,
      http: 200,
      status: "succes",
      newObservations: 1,
      observations: [
        {
          title: RECENT.title,
          url: RECENT.url,
          via: "google_news",
          publishedAt: RECENT.original,
        },
      ],
    });
    assertNoReservedFetch(asked);
  });

  it("3 — une date originale de 60 jours empêche l'ingestion malgré une indexation récente", async () => {
    expect(NOW.getTime() - Date.parse(STALE.original)).toBeGreaterThan(FRESHNESS_DAYS * DAY);
    const { asked, run, created } = await runGoogle({
      articles: [feed(STALE, INDEXED, "Les Echos", "lesechos.fr")],
      pages: {
        [STALE.url]: articleHtml({ title: STALE.title, datePublished: STALE.original }),
      },
    });
    expect({
      consulted: fetchCount(asked, STALE.url),
      http: run.status,
      status: run.body.status,
      newObservations: run.body.newObservations,
      observations: seen(created),
    }).toEqual({
      consulted: 1,
      http: 200,
      status: "succes_sans_actualite",
      newObservations: 0,
      observations: [],
    });
  });

  it("4 — le JSON-LD datePublished prime sur l'indexation et sur dateModified", async () => {
    expect(JSON_LD.original).not.toBe(INDEXED);
    expect(JSON_LD.modified).not.toBe(JSON_LD.original);
    const { asked, run, created } = await runGoogle({
      articles: [feed(JSON_LD, INDEXED, "Usine Nouvelle", "usinenouvelle.com")],
      pages: {
        [JSON_LD.url]: articleHtml({
          title: JSON_LD.title,
          datePublished: JSON_LD.original,
          dateModified: JSON_LD.modified,
        }),
      },
    });
    expect({
      consulted: fetchCount(asked, JSON_LD.url),
      observations: seen(created),
      status: run.body.status,
    }).toEqual({
      consulted: 1,
      status: "succes",
      observations: [
        {
          title: JSON_LD.title,
          url: JSON_LD.url,
          via: "google_news",
          publishedAt: JSON_LD.original,
        },
      ],
    });
  });

  it("5 — article:published_time est la date originale en l'absence de JSON-LD", async () => {
    expect(META.original).not.toBe(INDEXED);
    const { asked, created } = await runGoogle({
      articles: [feed(META, INDEXED, "La Tribune", "latribune.fr")],
      pages: {
        [META.url]: articleHtml({
          title: META.title,
          datePublished: META.original,
          jsonLd: false,
          publishedTime: true,
        }),
      },
    });
    expect({
      consulted: fetchCount(asked, META.url),
      observations: seen(created),
    }).toEqual({
      consulted: 1,
      observations: [
        {
          title: META.title,
          url: META.url,
          via: "google_news",
          publishedAt: META.original,
        },
      ],
    });
  });

  it("6 — une dateModified récente ne fait pas entrer un article publié il y a 60 jours", async () => {
    const { asked, run, created } = await runGoogle({
      articles: [feed(MODIFIED, hoursAgo(2), "Le Dauphiné", "ledauphine.com")],
      pages: {
        [MODIFIED.url]: articleHtml({
          title: MODIFIED.title,
          datePublished: MODIFIED.published,
          dateModified: MODIFIED.modified,
          publishedTime: true,
        }),
      },
    });
    expect({
      consulted: fetchCount(asked, MODIFIED.url),
      status: run.body.status,
      newObservations: run.body.newObservations,
      observations: seen(created),
    }).toEqual({
      consulted: 1,
      status: "succes_sans_actualite",
      newObservations: 0,
      observations: [],
    });
  });

  it("7 — une date originale fiable prime sur une date Google News contradictoire", async () => {
    expect(CONTRADICTED.original).not.toBe(INDEXED);
    expect(NOW.getTime() - Date.parse(CONTRADICTED.original)).toBeLessThan(FRESHNESS_DAYS * DAY);
    const { asked, created } = await runGoogle({
      articles: [feed(CONTRADICTED, INDEXED, "Le Monde Informatique", "lemondeinformatique.fr")],
      pages: {
        [CONTRADICTED.url]: articleHtml({
          title: CONTRADICTED.title,
          datePublished: CONTRADICTED.original,
        }),
      },
    });
    expect({
      consulted: fetchCount(asked, CONTRADICTED.url),
      observations: seen(created),
    }).toEqual({
      consulted: 1,
      observations: [
        {
          title: CONTRADICTED.title,
          url: CONTRADICTED.url,
          via: "google_news",
          publishedAt: CONTRADICTED.original,
        },
      ],
    });
  });

  it("8 — sans date originale vérifiable, pas d'ingestion automatique", async () => {
    /**
     * Politique conservatrice, pas une alternative laissée ouverte : l'article est exclu.
     * Faux négatif assumé si l'article est récent mais ne publie aucune date lisible.
     */
    const { asked, run, created } = await runGoogle({
      articles: [feed(UNKNOWN, INDEXED, "Revue de presse", "example-presse.fr")],
      pages: {
        [UNKNOWN.url]: articleHtml({
          title: UNKNOWN.title,
          datePublished: INDEXED,
          invalid: true,
          publishedTime: true,
        }),
      },
    });
    expect({
      consulted: fetchCount(asked, UNKNOWN.url),
      status: run.body.status,
      newObservations: run.body.newObservations,
      observations: seen(created),
    }).toEqual({
      consulted: 1,
      status: "succes_sans_actualite",
      newObservations: 0,
      observations: [],
    });
  });

  it("9a — un timeout éditeur n'interrompt pas la collecte et n'invente pas de date", async () => {
    const { asked, run, created } = await runGoogle({
      articles: [
        feed(TIMEOUT_ARTICLE, hoursAgo(1), "Éditeur", "editeur-timeout.example"),
        feed(SIBLING, isoAgo(2)),
      ],
      pages: {
        [TIMEOUT_ARTICLE.url]: () => {
          const error = new Error("Délai de réponse dépassé");
          error.name = "TimeoutError";
          throw error;
        },
        [SIBLING.url]: articleHtml({ title: SIBLING.title, datePublished: SIBLING.original }),
      },
    });
    expect({
      timeout: fetchCount(asked, TIMEOUT_ARTICLE.url),
      sibling: fetchCount(asked, SIBLING.url),
      http: run.status,
      status: run.body.status,
      newObservations: run.body.newObservations,
      observations: seen(created),
    }).toEqual({
      timeout: 1,
      sibling: 1,
      http: 200,
      status: "succes",
      newObservations: 1,
      observations: [
        {
          title: SIBLING.title,
          url: SIBLING.url,
          via: "google_news",
          publishedAt: SIBLING.original,
        },
      ],
    });
  });

  it("9b — un HTTP 500 éditeur n'interrompt pas la collecte et n'invente pas de date", async () => {
    const { asked, run, created } = await runGoogle({
      articles: [
        feed(HTTP_500, hoursAgo(1), "Éditeur", "editeur-500.example"),
        feed(SIBLING, isoAgo(2)),
      ],
      pages: {
        [HTTP_500.url]: () => new Response("erreur interne", { status: 500 }),
        [SIBLING.url]: articleHtml({ title: SIBLING.title, datePublished: SIBLING.original }),
      },
    });
    expect({
      failure: fetchCount(asked, HTTP_500.url),
      sibling: fetchCount(asked, SIBLING.url),
      http: run.status,
      status: run.body.status,
      newObservations: run.body.newObservations,
      observations: seen(created),
    }).toEqual({
      failure: 1,
      sibling: 1,
      http: 200,
      status: "succes",
      newObservations: 1,
      observations: [
        {
          title: SIBLING.title,
          url: SIBLING.url,
          via: "google_news",
          publishedAt: SIBLING.original,
        },
      ],
    });
  });

  it("10a — une URL interne présente dans le flux n'est jamais demandée", async () => {
    const dangerous = [
      { title: "KORA-DATES Pasqal lien métadonnées", url: METADATA },
      { title: "KORA-DATES Pasqal lien localhost", url: LOCALHOST },
      { title: "KORA-DATES Pasqal lien IPv6 local", url: IPV6_LOOPBACK },
      { title: "KORA-DATES Pasqal lien réseau privé", url: LAN },
    ];
    const { asked, run, created } = await runGoogle({
      articles: dangerous.map((item) => feed(item, INDEXED, "Interne", "example.com")),
      pages: Object.fromEntries(dangerous.map((item) => [item.url, "<html>secret</html>"])),
    });
    expect({
      google: asked.filter((url) => url.includes("news.google.com/rss/search")).length,
      metadata: fetchCount(asked, METADATA),
      localhost: fetchCount(asked, LOCALHOST),
      ipv6: fetchCount(asked, IPV6_LOOPBACK),
      lan: fetchCount(asked, LAN),
      http: run.status,
      status: run.body.status,
      newObservations: run.body.newObservations,
      observations: seen(created),
    }).toEqual({
      google: 1,
      metadata: 0,
      localhost: 0,
      ipv6: 0,
      lan: 0,
      http: 200,
      status: "succes_sans_actualite",
      newObservations: 0,
      observations: [],
    });
    assertNoReservedFetch(asked);
  });

  it("10b — une URL interne obtenue en résolvant Google News n'est jamais demandée", async () => {
    const lure = {
      title: "KORA-DATES Pasqal leurre résolu vers la boucle locale",
      url: "https://www.lesechos.fr/pasqal-leurre-kora-dates",
    };
    const { asked, resolved, run, created } = await runGoogle({
      articles: [feed(lure, INDEXED, "Les Echos", "lesechos.fr")],
      links: { [gnRedirect(0)]: LOOPBACK },
      pages: { [LOOPBACK]: "<html>secret</html>" },
    });
    expect({
      resolved: resolved.includes(gnRedirect(0)),
      loopback: fetchCount(asked, LOOPBACK),
      http: run.status,
      status: run.body.status,
      newObservations: run.body.newObservations,
      observations: seen(created),
    }).toEqual({
      resolved: true,
      loopback: 0,
      http: 200,
      status: "succes_sans_actualite",
      newObservations: 0,
      observations: [],
    });
    assertNoReservedFetch(asked);
  });

  it("10c — une redirection HTTP vers une adresse privée n'est pas suivie", async () => {
    const redirect = { title: REDIRECT_TITLE, url: REDIRECT_PUBLIC };
    const { asked, run, created } = await runGoogle({
      articles: [feed(redirect, hoursAgo(1), "Les Echos", "lesechos.fr"), feed(SIBLING, isoAgo(2))],
      pages: {
        [REDIRECT_PUBLIC]: () =>
          new Response(null, { status: 302, headers: { location: REDIRECT_PRIVATE } }),
        [SIBLING.url]: articleHtml({ title: SIBLING.title, datePublished: SIBLING.original }),
      },
    });
    expect({
      publisher: fetchCount(asked, REDIRECT_PUBLIC),
      privateTarget: fetchCount(asked, REDIRECT_PRIVATE),
      sibling: fetchCount(asked, SIBLING.url),
      http: run.status,
      status: run.body.status,
      newObservations: run.body.newObservations,
      observations: seen(created),
    }).toEqual({
      publisher: 1,
      privateTarget: 0,
      sibling: 1,
      http: 200,
      status: "succes",
      newObservations: 1,
      observations: [
        {
          title: SIBLING.title,
          url: SIBLING.url,
          via: "google_news",
          publishedAt: SIBLING.original,
        },
      ],
    });
    assertNoReservedFetch(asked);
  });

  it("11 — les archives réindexées ne consomment pas les cinq places d'ingestion", async () => {
    const archives = [0, 1, 2, 3, 4].map((n) => ({
      title: `KORA-DATES Pasqal archive n°${n} ressortie par Google News`,
      url: `https://www.archives-presse.example/pasqal-archive-${n}`,
      original: ORIGINAL_2019,
      indexed: hoursAgo(n + 1),
    }));
    const genuine = [
      { ...RECENT, indexed: isoAgo(3) },
      { ...HALL, indexed: isoAgo(4) },
    ];
    const candidates = [...archives, ...genuine];
    const pages = Object.fromEntries(
      candidates.map((item) => [
        item.url,
        articleHtml({ title: item.title, datePublished: item.original }),
      ]),
    );
    const { asked, run, created } = await runGoogle({
      articles: [
        ...archives.map((item) => feed(item, item.indexed, "Archives", "archives-presse.example")),
        ...genuine.map((item) => feed(item, item.indexed)),
      ],
      pages,
    });
    // Une lecture par candidat de ce flux, pas `MAX_ITEMS`. Cette constante borne
    // l'ingestion. L'appliquer aux lectures laisserait les cinq archives, plus
    // récentes selon Google News, occuper les cinq places avant les deux articles
    // réellement datés. Ce flux tient sous `MAX_GOOGLE_NEWS_CHECKS` : le plafond
    // de quinze candidats est vérifié par un test distinct.
    expect(candidates.length).toBeGreaterThan(MAX_ITEMS);
    expect({
      publisherFetches: Object.fromEntries(
        candidates.map((item) => [item.url, fetchCount(asked, item.url)]),
      ),
      newObservations: run.body.newObservations,
      observations: seen(created),
    }).toEqual({
      publisherFetches: Object.fromEntries(candidates.map((item) => [item.url, 1])),
      newObservations: genuine.length,
      observations: genuine
        .map((item) => ({
          title: item.title,
          url: item.url,
          via: "google_news" as const,
          publishedAt: item.original,
        }))
        .sort((a, b) => a.title.localeCompare(b.title, "fr")),
    });
    expect(created.length).toBeLessThanOrEqual(MAX_ITEMS);
    assertNoReservedFetch(asked);
  });

  it("12 — VideoObject : uploadDate seule, distincte de la réindexation Google News", async () => {
    expect(UPLOAD.uploadDate).not.toBe(INDEXED);
    expect(NOW.getTime() - Date.parse(UPLOAD.uploadDate)).toBeLessThan(FRESHNESS_DAYS * DAY);
    const { asked, created } = await runGoogle({
      articles: [feed(UPLOAD, INDEXED, "YouTube", "youtube.com")],
      pages: {
        [UPLOAD.url]: articleHtml({ title: UPLOAD.title, uploadDate: UPLOAD.uploadDate }),
      },
    });
    expect({
      consulted: fetchCount(asked, UPLOAD.url),
      observations: seen(created),
    }).toEqual({
      consulted: 1,
      observations: [
        {
          title: UPLOAD.title,
          url: UPLOAD.url,
          via: "google_news",
          publishedAt: UPLOAD.uploadDate,
        },
      ],
    });
  });

  it("13 — vidéo Kalray de 2019 reprise par Orange : 403 ou error403.html, aucune date inventée", async () => {
    /**
     * Cas réel : une vidéo Kalray publiée en 2019 est réindexée par Google News avec une date
     * récente. Orange Actualités répond 403, ou redirige vers `error403.html`.
     * Le corps simulé de ces réponses porte une date récente : le test échoue si on l'utilise,
     * si on suit la redirection, ou si on conserve la date d'indexation.
     */
    const freshOnErrorPage = isoAgo(3);
    const blocked = {
      title: "KORA-DATES Kalray : vidéo de 2019 reprise par Orange Actualités",
      url: "https://actu.orange.fr/kalray-video-2019-kora-dates",
    };
    const redirected = {
      title: "KORA-DATES Kalray : autre reprise Orange de la vidéo de 2019",
      url: "https://actu.orange.fr/kalray-video-2019-bis-kora-dates",
    };
    const errorPage = "https://actu.orange.fr/error403.html";
    const tempting = articleHtml({
      title: blocked.title,
      datePublished: freshOnErrorPage,
      uploadDate: freshOnErrorPage,
      video: true,
    });
    expect(NOW.getTime() - Date.parse(freshOnErrorPage)).toBeLessThan(FRESHNESS_DAYS * DAY);
    const { asked, run, created } = await runGoogle({
      articles: [
        feed(blocked, hoursAgo(1), "Orange Actualités", "actu.orange.fr"),
        feed(redirected, INDEXED, "Orange Actualités", "actu.orange.fr"),
        feed(SIBLING, isoAgo(2)),
      ],
      pages: {
        [blocked.url]: () => new Response(tempting, { status: 403 }),
        [redirected.url]: () =>
          new Response(null, { status: 302, headers: { location: errorPage } }),
        [errorPage]: tempting,
        [SIBLING.url]: articleHtml({ title: SIBLING.title, datePublished: SIBLING.original }),
      },
    });
    expect({
      blocked: fetchCount(asked, blocked.url),
      redirected: fetchCount(asked, redirected.url),
      errorPage: fetchCount(asked, errorPage),
      sibling: fetchCount(asked, SIBLING.url),
      http: run.status,
      status: run.body.status,
      newObservations: run.body.newObservations,
      observations: seen(created),
    }).toEqual({
      blocked: 1,
      redirected: 1,
      errorPage: 0,
      sibling: 1,
      http: 200,
      status: "succes",
      newObservations: 1,
      observations: [
        {
          title: SIBLING.title,
          url: SIBLING.url,
          via: "google_news",
          publishedAt: SIBLING.original,
        },
      ],
    });
    assertNoReservedFetch(asked);
  });

  it("14 — quinze candidats au plus : les archives examinées n'empêchent pas l'article suivant, le seizième n'est pas lu", async () => {
    const archives = Array.from({ length: MAX_GOOGLE_NEWS_CHECKS - 1 }, (_, n) => ({
      title: `KORA-DATES Pasqal archive bornée n°${n}`,
      url: `https://www.archives-presse.example/pasqal-borne-${n}`,
      original: ORIGINAL_2019,
      indexed: hoursAgo(n + 1),
    }));
    const kept = {
      title: "KORA-DATES Pasqal article récent encore dans la limite",
      url: "https://www.placegrenet.fr/pasqal-dans-la-limite-kora-dates",
      original: isoAgo(6),
      indexed: hoursAgo(MAX_GOOGLE_NEWS_CHECKS + 1),
    };
    const skipped = {
      title: "KORA-DATES Pasqal article récent au-delà de la limite",
      url: "https://www.placegrenet.fr/pasqal-hors-limite-kora-dates",
      original: isoAgo(8),
      indexed: isoAgo(2),
    };
    const examined = [...archives, kept];
    expect(examined.length).toBe(MAX_GOOGLE_NEWS_CHECKS);
    expect(MAX_GOOGLE_NEWS_CHECKS).toBeGreaterThan(MAX_ITEMS);
    const { asked, resolved, run, created } = await runGoogle({
      articles: [
        ...archives.map((item) => feed(item, item.indexed, "Archives", "archives-presse.example")),
        feed(kept, kept.indexed),
        feed(skipped, skipped.indexed),
      ],
      pages: Object.fromEntries(
        [...examined, skipped].map((item) => [
          item.url,
          articleHtml({ title: item.title, datePublished: item.original }),
        ]),
      ),
    });
    expect(resolved).toHaveLength(MAX_GOOGLE_NEWS_CHECKS);
    expect({
      kept: fetchCount(asked, kept.url),
      skipped: fetchCount(asked, skipped.url),
      archives: archives.every((item) => fetchCount(asked, item.url) === 1),
      newObservations: run.body.newObservations,
      observations: seen(created),
    }).toEqual({
      kept: 1,
      skipped: 0,
      archives: true,
      newObservations: 1,
      observations: [
        {
          title: kept.title,
          url: kept.url,
          via: "google_news",
          publishedAt: kept.original,
        },
      ],
    });
  });

  it("15 — le budget de temps arrête la résolution et ne lance plus de lecture éditeur", async () => {
    const first = {
      title: "KORA-DATES Pasqal article lu avant le budget",
      url: "https://www.placegrenet.fr/pasqal-budget-1-kora-dates",
      original: isoAgo(6),
    };
    const second = {
      title: "KORA-DATES Pasqal redirection résolue après le budget",
      url: "https://www.placegrenet.fr/pasqal-budget-2-kora-dates",
      original: isoAgo(7),
    };
    const third = {
      title: "KORA-DATES Pasqal article non examiné faute de temps",
      url: "https://www.placegrenet.fr/pasqal-budget-3-kora-dates",
      original: isoAgo(8),
    };
    let wall = 1_700_000_000_000;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => wall);
    try {
      const { asked, resolved, run, created } = await runGoogle({
        articles: [feed(first, hoursAgo(1)), feed(second, hoursAgo(2)), feed(third, hoursAgo(3))],
        pages: {
          [first.url]: articleHtml({ title: first.title, datePublished: first.original }),
          [second.url]: articleHtml({ title: second.title, datePublished: second.original }),
          [third.url]: articleHtml({ title: third.title, datePublished: third.original }),
        },
        onResolve: () => {
          wall += GOOGLE_NEWS_DATE_BUDGET_MS / 2;
        },
      });
      expect(GOOGLE_NEWS_DATE_BUDGET_MS).toBe(60_000);
      expect({
        resolved,
        first: fetchCount(asked, first.url),
        second: fetchCount(asked, second.url),
        third: fetchCount(asked, third.url),
        status: run.body.status,
        newObservations: run.body.newObservations,
        observations: seen(created),
      }).toEqual({
        resolved: [gnRedirect(0), gnRedirect(1)],
        first: 1,
        second: 0,
        third: 0,
        status: "succes",
        newObservations: 1,
        observations: [
          {
            title: first.title,
            url: first.url,
            via: "google_news",
            publishedAt: first.original,
          },
        ],
      });
    } finally {
      spy.mockRestore();
    }
  });

  it("16 — une URL d'éditeur déjà dans le flux est vérifiée, sans décoder de redirection", async () => {
    const direct = {
      title: "KORA-DATES Pasqal lien éditeur direct dans Google News",
      url: "https://www.lesechos.fr/pasqal-lien-direct-kora-dates",
      original: isoAgo(6),
    };
    const stale = {
      title: "KORA-DATES Pasqal lien direct trop ancien",
      url: "https://www.latribune.fr/pasqal-lien-direct-ancien-kora-dates",
      original: isoAgo(60),
    };
    expect(direct.original).not.toBe(INDEXED);
    const { asked, resolved, run, created } = await runGoogle({
      asRedirect: false,
      articles: [
        feed(direct, INDEXED, "Les Echos", "lesechos.fr"),
        feed(stale, hoursAgo(2), "La Tribune", "latribune.fr"),
      ],
      pages: {
        [direct.url]: articleHtml({ title: direct.title, datePublished: direct.original }),
        [stale.url]: articleHtml({ title: stale.title, datePublished: stale.original }),
      },
    });
    expect({
      resolved,
      direct: fetchCount(asked, direct.url),
      stale: fetchCount(asked, stale.url),
      status: run.body.status,
      newObservations: run.body.newObservations,
      observations: seen(created),
    }).toEqual({
      resolved: [],
      direct: 1,
      stale: 1,
      status: "succes",
      newObservations: 1,
      observations: [
        {
          title: direct.title,
          url: direct.url,
          via: "google_news",
          publishedAt: direct.original,
        },
      ],
    });
  });

  it("17 — dates contradictoires exclues ; la date d'un objet lié n'est pas celle de l'article", async () => {
    const linked = {
      title: "KORA-DATES Pasqal l'article prime sur la vidéo liée",
      url: "https://www.placegrenet.fr/pasqal-video-liee-kora-dates",
      original: isoAgo(6),
    };
    const conflict = {
      title: "KORA-DATES Pasqal dates de publication contradictoires",
      url: "https://www.lesechos.fr/pasqal-dates-contradictoires-kora-dates",
      jsonLd: isoAgo(5),
      meta: isoAgo(3),
    };
    expect(linked.original).not.toBe(INDEXED);
    expect(conflict.jsonLd).not.toBe(conflict.meta);
    const linkedHtml = `<!DOCTYPE html><html><head>
      <meta property="article:published_time" content="${linked.original}" />
      <script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "VideoObject",
            name: "reprise",
            uploadDate: INDEXED,
            datePublished: INDEXED,
          },
          {
            "@type": "NewsArticle",
            headline: linked.title,
            datePublished: linked.original,
          },
        ],
      })}</script>
    </head><body><p>${linked.title}. Pasqal à Grenoble.</p></body></html>`;
    const conflictHtml = `<!DOCTYPE html><html><head>
      <meta property="article:published_time" content="${conflict.meta}" />
      <script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        headline: conflict.title,
        datePublished: conflict.jsonLd,
      })}</script>
    </head><body><p>${conflict.title}. Pasqal à Grenoble.</p></body></html>`;
    const { asked, created } = await runGoogle({
      articles: [
        feed(linked, hoursAgo(1)),
        feed(conflict, hoursAgo(2), "Les Echos", "lesechos.fr"),
      ],
      pages: { [linked.url]: linkedHtml, [conflict.url]: conflictHtml },
    });
    expect({
      linked: fetchCount(asked, linked.url),
      conflict: fetchCount(asked, conflict.url),
      observations: seen(created),
    }).toEqual({
      linked: 1,
      conflict: 1,
      observations: [
        {
          title: linked.title,
          url: linked.url,
          via: "google_news",
          publishedAt: linked.original,
        },
      ],
    });
  });

  it("18 — page trop volumineuse ou d'un autre type : pas de date, corps non chargé en entier", async () => {
    const heavy = {
      title: "KORA-DATES Pasqal page éditeur trop volumineuse",
      url: "https://www.lesechos.fr/pasqal-page-volumineuse-kora-dates",
    };
    const binary = {
      title: "KORA-DATES Pasqal page éditeur au mauvais type",
      url: "https://www.latribune.fr/pasqal-mauvais-type-kora-dates",
    };
    const chunk = 64 * 1024;
    let pulled = 0;
    const head = articleHtml({ title: heavy.title, datePublished: isoAgo(4) });
    const filler = new Uint8Array(chunk);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled === 0) {
          const bytes = new TextEncoder().encode(head);
          pulled += bytes.byteLength;
          controller.enqueue(bytes);
          return;
        }
        if (pulled >= MAX_PUBLISHER_HTML_BYTES * 2) {
          controller.close();
          return;
        }
        pulled += filler.byteLength;
        controller.enqueue(filler);
      },
    });
    const { asked, run, created } = await runGoogle({
      articles: [
        feed(heavy, hoursAgo(1), "Les Echos", "lesechos.fr"),
        feed(binary, hoursAgo(2), "La Tribune", "latribune.fr"),
        feed(SIBLING, isoAgo(2)),
      ],
      pages: {
        [heavy.url]: () =>
          new Response(stream, {
            status: 200,
            headers: {
              "content-type": "text/html; charset=utf-8",
              "content-length": "100",
            },
          }),
        [binary.url]: () =>
          new Response(articleHtml({ title: binary.title, datePublished: isoAgo(4) }), {
            status: 200,
            headers: { "content-type": "application/pdf" },
          }),
        [SIBLING.url]: articleHtml({ title: SIBLING.title, datePublished: SIBLING.original }),
      },
    });
    expect(pulled).toBeGreaterThan(MAX_PUBLISHER_HTML_BYTES);
    expect(pulled).toBeLessThanOrEqual(MAX_PUBLISHER_HTML_BYTES + chunk * 2);
    expect({
      heavy: fetchCount(asked, heavy.url),
      binary: fetchCount(asked, binary.url),
      sibling: fetchCount(asked, SIBLING.url),
      status: run.body.status,
      newObservations: run.body.newObservations,
      observations: seen(created),
    }).toEqual({
      heavy: 1,
      binary: 1,
      sibling: 1,
      status: "succes",
      newObservations: 1,
      observations: [
        {
          title: SIBLING.title,
          url: SIBLING.url,
          via: "google_news",
          publishedAt: SIBLING.original,
        },
      ],
    });
  });

  it("19 — le budget annule la requête Google News : pas de décodage, pas d'observation, nouvel essai", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    let wall = 1_700_000_000_000;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => wall);
    const kept = {
      title: "KORA-DATES Pasqal article lu avant l'annulation",
      url: "https://www.placegrenet.fr/pasqal-avant-annulation-kora-dates",
      original: isoAgo(4),
    };
    const slow = {
      title: "KORA-DATES Pasqal article dont la redirection est annulée",
      url: "https://www.placegrenet.fr/pasqal-annulation-budget-kora-dates",
      original: isoAgo(6),
    };
    const slowId = "CBMiWkFVX3lxTE1uWGxhdGVzdC1pZC1zYW5zLWFkcmVzc2U";
    const pageHtml = `<html><body><c-wiz data-n-a-sg="AQ-sig" data-n-a-ts="1761480000"></c-wiz></body></html>`;
    const decode = `)]}'\n\n[["wrb.fr","Fbv4je","[\\"garturlres\\",\\"${slow.url}\\",\\"${slowId}\\"]",null,null,null,"generic"]]`;
    const rss = `<?xml version="1.0"?><rss version="2.0"><channel>
      <item>
        <title>${kept.title} - Place Gre'net</title>
        <link>https://news.google.com/rss/articles/${legacyArticleId(kept.url)}</link>
        <pubDate>${new Date(hoursAgo(1)).toUTCString()}</pubDate>
        <description>${kept.title}</description>
        <source url="https://www.placegrenet.fr">Place Gre'net</source>
      </item>
      <item>
        <title>${slow.title} - Place Gre'net</title>
        <link>https://news.google.com/rss/articles/${slowId}</link>
        <pubDate>${new Date(hoursAgo(2)).toUTCString()}</pubDate>
        <description>${slow.title}</description>
        <source url="https://www.placegrenet.fr">Place Gre'net</source>
      </item>
    </channel></rss>`;
    const signals: AbortSignal[] = [];
    let articleCalls = 0;
    let decodeCalls = 0;
    let succeed = false;
    try {
      vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.includes("news.google.com/rss/search")) return new Response(rss);
        if (url.startsWith("https://news.google.com/rss/articles/")) {
          articleCalls += 1;
          const signal = init?.signal;
          if (signal) signals.push(signal);
          if (succeed) return new Response(pageHtml);
          return new Promise<Response>((resolve) => {
            signal?.addEventListener(
              "abort",
              () => {
                resolve(new Response(pageHtml));
              },
              { once: true },
            );
          });
        }
        if (url.endsWith("/batchexecute")) {
          decodeCalls += 1;
          return new Response(decode);
        }
        if (url === kept.url) {
          wall += 55_000;
          return new Response(articleHtml({ title: kept.title, datePublished: kept.original }), {
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        }
        if (url === slow.url) {
          return new Response(articleHtml({ title: slow.title, datePublished: slow.original }), {
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        }
        return new Response("introuvable", { status: 404 });
      });
      const resolver = new GoogleNewsLinkResolver();
      setAdapters({ collector: new RealCollector({}), links: resolver });
      const sources = await call<Source[]>("GET", "/sources?companyId=co_pasqal");
      const source = sources.body.find((item) => item.type === "recherche_web");
      expect(source).toBeDefined();
      const firstRun = call<CollectionRun>("POST", `/sources/${source!.id}/collect`);
      for (let i = 0; i < 30 && signals.length === 0; i += 1) {
        await vi.advanceTimersByTimeAsync(0);
      }
      expect(signals).toHaveLength(1);
      expect(signals[0]!.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(4_999);
      expect(signals[0]!.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(signals[0]!.aborted).toBe(true);
      const run = await firstRun;
      const created = (await (await getRepository()).observations.list()).filter((observation) =>
        observation.title.includes("KORA-DATES"),
      );
      expect(decodeCalls).toBe(0);
      expect(articleCalls).toBe(1);
      expect({
        status: run.body.status,
        observations: seen(created),
      }).toEqual({
        status: "succes",
        observations: [
          {
            title: kept.title,
            url: kept.url,
            via: "google_news",
            publishedAt: kept.original,
          },
        ],
      });

      succeed = true;
      const retry = await call<CollectionRun>("POST", `/sources/${source!.id}/collect`);
      const after = (await (await getRepository()).observations.list()).filter((observation) =>
        observation.title.includes("KORA-DATES"),
      );
      expect(articleCalls).toBe(2);
      expect(decodeCalls).toBe(1);
      expect(retry.body.status).toBe("succes");
      expect(seen(after)).toEqual([
        {
          title: slow.title,
          url: slow.url,
          via: "google_news",
          publishedAt: slow.original,
        },
        {
          title: kept.title,
          url: kept.url,
          via: "google_news",
          publishedAt: kept.original,
        },
      ]);
    } finally {
      spy.mockRestore();
      vi.useRealTimers();
    }
  });
});

/** Ancien identifiant Google News : l'adresse éditeur est dans le protobuf, sans réseau. */
function legacyArticleId(url: string): string {
  const body = new TextEncoder().encode(url);
  const bytes = new Uint8Array([0x08, 0x13, 0x22, body.length, ...body, 0xd2, 0x01, 0x00]);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
