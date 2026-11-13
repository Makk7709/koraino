/**
 * Motif des articles Google News écartés par la vérification de la date.
 *
 * Un article dont la date originale n'est pas confirmée n'est pas ingéré (voir
 * `dates-publication.test.ts`). Une source ne doit pas pour autant se vider sans explication :
 * la collecte porte l'avertissement `DATE_REJECTED`, avec le nombre d'articles écartés par
 * motif, visible dans l'historique des collectes ; ou `DATE_UNCHECKED` quand rien n'est
 * écarté mais que la vérification s'est arrêtée trop tôt.
 *
 * Quand Perplexity a renvoyé le même article, sa version remplace l'article Google News dont la
 * date n'a pas pu être vérifiée : l'article n'est alors ni perdu ni compté parmi les écartés.
 *
 * Un média qui refuse deux fois la lecture n'est plus sollicité pendant la collecte : ses autres
 * articles sont comptés inaccessibles sans requête, et les vérifications restent aux autres médias.
 * Aucun test n'appelle le réseau.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CollectionRun, Source } from "@/lib/api/types";
import { setAdapters } from "@/server/adapters";
import { mergeEnrichment, RealCollector, type RawItem } from "@/server/adapters/collector";
import {
  DATE_REJECTED,
  DATE_UNCHECKED,
  GOOGLE_NEWS_DATE_BUDGET_MS,
  MAX_GOOGLE_NEWS_CHECKS,
  MAX_ITEMS,
  MAX_PUBLISHER_REFUSALS,
} from "@/server/services/collection";
import { checkPublishedAt } from "@/server/services/publisher-page";
import { getRepository } from "@/server/store/memory";
import { call, NOW, setup, teardown } from "./helpers";

const KEYS = { LOVABLE_API_KEY: "cle-passerelle", PERPLEXITY_API_KEY: "cle-connexion" };

const DAY = 86_400_000;
const isoAgo = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

interface Article {
  title: string;
  url: string;
  page: string | (() => Response);
  /** Adresse rendue par la résolution du lien Google News ; `null` : lien non résolu. */
  link?: string | null;
  /** Adresse du média annoncée par le flux ; par défaut, l'origine de `url`. */
  media?: string;
}

const HOST = "presse-motifs.example";

function page(datePublished?: string): string {
  const ld = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    ...(datePublished ? { datePublished } : {}),
  };
  return `<!DOCTYPE html><html><head><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body></body></html>`;
}

const htmlResponse = (body: string) =>
  new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });

function article(slug: string, body: Article["page"], link?: string | null): Article {
  return {
    title: `KORA-MOTIFS Pasqal ${slug}`,
    // Adresse en ASCII : l'application la normalise, le double de `fetch` compare à l'identique.
    url: `https://www.${HOST}/${slug.replace(/[^a-z0-9]+/gi, "-")}`,
    page: body,
    ...(link === undefined ? {} : { link }),
  };
}

const fresh = (slug: string) => article(slug, page(isoAgo(3)));
const old = (slug: string) => article(slug, page(isoAgo(60)));
const blocked = (slug: string, status = 403) =>
  article(slug, () => new Response("refusé", { status }));

/** Résultat de la recherche Perplexity, tel que le renvoie la passerelle. */
interface PerplexityResult {
  title: string;
  url: string;
  snippet: string;
  date: string;
}

/** Le même article vu par Perplexity : même titre, autre adresse, date propre à Perplexity. */
function samePerplexity(a: Article, daysAgo = 4): PerplexityResult {
  return {
    title: a.title,
    url: `https://www.reprise-perplexity.example${new URL(a.url).pathname}`,
    snippet: `${a.title}, d'après la presse.`,
    date: isoAgo(daysAgo),
  };
}

function stubPages(articles: Article[], rss = "", perplexity?: PerplexityResult[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/perplexity/search")) return Response.json({ results: perplexity ?? [] });
      if (url.includes("news.google.com/rss/search")) return new Response(rss);
      const found = articles.find((a) => a.url === url);
      if (!found) return new Response("introuvable", { status: 404 });
      return typeof found.page === "function" ? found.page() : htmlResponse(found.page);
    }),
  );
}

/** Collecte de la source Google News de Pasqal, sur un flux et des pages simulés. */
async function collect(
  articles: Article[],
  opts: { onResolve?: () => void; perplexity?: PerplexityResult[] } = {},
): Promise<CollectionRun> {
  const redirect = (index: number) => `https://news.google.com/rss/articles/motif${index}`;
  const items = articles.map(
    (a, index) => `<item>
  <title>${a.title} - Presse Motifs</title>
  <link>${redirect(index)}</link>
  <pubDate>${new Date(NOW.getTime() - (index + 1) * 60_000).toUTCString()}</pubDate>
  <description>${a.title}</description>
  <source url="${a.media ?? new URL(a.url).origin}">Presse Motifs</source>
</item>`,
  );
  stubPages(
    articles,
    `<?xml version="1.0"?><rss version="2.0"><channel>${items.join("\n")}</channel></rss>`,
    opts.perplexity,
  );
  setAdapters({
    collector: new RealCollector(opts.perplexity ? KEYS : {}),
    links: {
      name: "liens-motifs-test",
      async resolve(url: string): Promise<string | null> {
        opts.onResolve?.();
        const found = articles[Number(url.split("motif")[1])];
        if (!found) return null;
        return found.link === undefined ? found.url : found.link;
      },
    },
  });
  const sources = await call<Source[]>("GET", "/sources?companyId=co_pasqal");
  const source = sources.body.find((item) => item.type === "recherche_web");
  expect(source, "source recherche web Pasqal").toBeDefined();
  const run = await call<CollectionRun>("POST", `/sources/${source!.id}/collect`);
  expect(run.status).toBe(200);
  return run.body;
}

const outcome = (run: CollectionRun) => ({
  status: run.status,
  newObservations: run.newObservations,
  errorCode: run.errorCode,
  errorMessage: run.errorMessage,
});

afterEach(() => vi.unstubAllGlobals());

describe("articles Google News écartés : motif dans l'historique", () => {
  beforeEach(() => setup());
  afterEach(teardown);

  it("ne porte aucun avertissement quand toutes les dates sont confirmées", async () => {
    expect(outcome(await collect([fresh("article confirmé")]))).toEqual({
      status: "succes",
      newObservations: 1,
      errorCode: null,
      errorMessage: null,
    });
  });

  it("explique une source vidée par une page d'éditeur inaccessible", async () => {
    expect(outcome(await collect([blocked("article derrière un refus 403")]))).toEqual({
      status: "succes_sans_actualite",
      newObservations: 0,
      errorCode: DATE_REJECTED,
      errorMessage:
        "Google News : 1 publication écartée par la vérification de la date (1 page d'éditeur inaccessible).",
    });
  });

  it("compte chaque motif, sans faire échouer la collecte", async () => {
    const run = await collect([
      blocked("refus 403"),
      blocked("erreur 500", 500),
      article("page sans date", page()),
      old("publication ancienne"),
      article("lien non résolu", page(isoAgo(2)), null),
      fresh("article confirmé parmi les écartés"),
    ]);
    expect(outcome(run)).toEqual({
      status: "succes",
      newObservations: 1,
      errorCode: DATE_REJECTED,
      errorMessage:
        "Google News : 5 publications écartées par la vérification de la date (2 pages d'éditeur inaccessibles, 1 sans date de publication lisible, 1 hors de la fenêtre de 30 jours, 1 lien non résolu).",
    });
  });

  it("cite à part les articles non examinés au-delà de la limite de vérifications", async () => {
    const archives = Array.from({ length: MAX_GOOGLE_NEWS_CHECKS }, (_, n) => old(`archive ${n}`));
    const run = await collect([
      ...archives,
      fresh("premier hors limite"),
      fresh("second hors limite"),
    ]);
    expect(outcome(run)).toEqual({
      status: "succes_sans_actualite",
      newObservations: 0,
      errorCode: DATE_REJECTED,
      errorMessage: `Google News : ${MAX_GOOGLE_NEWS_CHECKS} publications écartées par la vérification de la date (${MAX_GOOGLE_NEWS_CHECKS} hors de la fenêtre de 30 jours) ; 2 non examinées (limite de ${MAX_GOOGLE_NEWS_CHECKS} vérifications ou de 60 s par source).`,
    });
  });

  it("n'avertit pas quand la limite s'arrête sur une collecte déjà pleine, sans refus", async () => {
    const many = Array.from({ length: MAX_GOOGLE_NEWS_CHECKS + 3 }, (_, n) => fresh(`récent ${n}`));
    expect(MAX_GOOGLE_NEWS_CHECKS).toBeGreaterThanOrEqual(MAX_ITEMS);
    expect(outcome(await collect(many))).toEqual({
      status: "succes",
      newObservations: MAX_ITEMS,
      errorCode: null,
      errorMessage: null,
    });
  });

  it("signale DATE_UNCHECKED quand le budget de temps s'arrête avant d'avoir rempli la collecte", async () => {
    let wall = 1_700_000_000_000;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => wall);
    try {
      const run = await collect(
        [fresh("lu avant le budget"), fresh("résolu après le budget"), fresh("jamais examiné")],
        {
          onResolve: () => {
            wall += GOOGLE_NEWS_DATE_BUDGET_MS / 2;
          },
        },
      );
      expect(outcome(run)).toEqual({
        status: "succes",
        newObservations: 1,
        errorCode: DATE_UNCHECKED,
        errorMessage: `Google News : 2 publications non examinées (limite de ${MAX_GOOGLE_NEWS_CHECKS} vérifications ou de 60 s par source).`,
      });
    } finally {
      spy.mockRestore();
    }
  });

  it("ne recompte pas un article déjà connu à la collecte suivante", async () => {
    const articles = [fresh("article déjà ingéré"), blocked("refus persistant")];
    expect((await collect(articles)).newObservations).toBe(1);
    expect(outcome(await collect(articles))).toEqual({
      status: "succes_sans_actualite",
      newObservations: 0,
      errorCode: DATE_REJECTED,
      errorMessage:
        "Google News : 1 publication écartée par la vérification de la date (1 page d'éditeur inaccessible).",
    });
  });
});

describe("média qui refuse la lecture : ses autres pages ne sont plus demandées", () => {
  beforeEach(() => setup());
  afterEach(teardown);

  /** Le même article, publié par un autre média. */
  const on = (host: string, a: Article): Article => ({ ...a, url: a.url.replace(HOST, host) });

  /** Pages d'éditeur demandées pendant la collecte. */
  const pageRequests = () =>
    vi
      .mocked(fetch)
      .mock.calls.map(([input]) => String(input instanceof Request ? input.url : input))
      .filter((url) => !url.includes("news.google.com") && !url.includes("/perplexity/"));

  async function collectCounting(articles: Article[], perplexity?: PerplexityResult[]) {
    let resolved = 0;
    const run = await collect(articles, {
      onResolve: () => (resolved += 1),
      ...(perplexity ? { perplexity } : {}),
    });
    return { run, resolved, pages: pageRequests() };
  }

  it.each([401, 403, 429])(
    "après deux refus %i, les autres articles du média sont comptés inaccessibles sans requête",
    async (status) => {
      const closed = Array.from({ length: 5 }, (_, n) =>
        blocked(`refus ${status} numéro ${n}`, status),
      );
      const { run, resolved, pages } = await collectCounting(closed);
      expect(MAX_PUBLISHER_REFUSALS).toBe(2);
      expect(outcome(run)).toEqual({
        status: "succes_sans_actualite",
        newObservations: 0,
        errorCode: DATE_REJECTED,
        errorMessage:
          "Google News : 5 publications écartées par la vérification de la date (5 pages d'éditeur inaccessibles).",
      });
      expect(pages).toEqual([closed[0]!.url, closed[1]!.url]);
      expect(resolved).toBe(2);
    },
  );

  it("un média fermé n'occupe plus les vérifications : les autres médias sont lus", async () => {
    const closed = Array.from({ length: MAX_GOOGLE_NEWS_CHECKS + 2 }, (_, n) =>
      blocked(`média fermé ${n}`),
    );
    const open = [
      on("autre-media.example", fresh("lu après le média fermé")),
      on("autre-media.example", fresh("lu aussi")),
    ];
    const { run, pages } = await collectCounting([...closed, ...open]);
    expect(outcome(run)).toEqual({
      status: "succes",
      newObservations: 2,
      errorCode: DATE_REJECTED,
      errorMessage: `Google News : ${closed.length} publications écartées par la vérification de la date (${closed.length} pages d'éditeur inaccessibles).`,
    });
    expect(pages).toEqual([closed[0]!.url, closed[1]!.url, open[0]!.url, open[1]!.url]);
  });

  it("deux médias sont comptés séparément : un refus chacun ne ferme ni l'un ni l'autre", async () => {
    const articles = [
      blocked("premier média, premier refus"),
      on("autre-media.example", blocked("second média, premier refus")),
      fresh("premier média, page lisible"),
      on("autre-media.example", fresh("second média, page lisible")),
    ];
    const { run, pages } = await collectCounting(articles);
    expect(outcome(run)).toMatchObject({
      newObservations: 2,
      errorMessage:
        "Google News : 2 publications écartées par la vérification de la date (2 pages d'éditeur inaccessibles).",
    });
    expect(pages).toHaveLength(4);
  });

  it.each<[string, Article["page"]]>([
    ["erreur 500", () => new Response("panne", { status: 500 })],
    ["page introuvable 404", () => new Response("introuvable", { status: 404 })],
    [
      "erreur réseau",
      () => {
        throw new TypeError("fetch failed");
      },
    ],
    ["page sans date", page()],
  ])("%s : ce n'est pas un refus, le média reste lu", async (label, body) => {
    const articles = [
      article(`${label} un`, body),
      article(`${label} deux`, body),
      article(`${label} trois`, body),
      fresh(`${label} puis une page lisible`),
    ];
    const { run, pages } = await collectCounting(articles);
    expect(pages).toEqual(articles.map((a) => a.url));
    expect(run.newObservations).toBe(1);
  });

  it("reprend par Perplexity un article d'un média fermé, sans le demander", async () => {
    const closed = [blocked("fermé un"), blocked("fermé deux"), blocked("fermé et repris")];
    const twin = samePerplexity(closed[2]!);
    const { run, pages } = await collectCounting(closed, [twin]);
    expect(outcome(run)).toEqual({
      status: "succes",
      newObservations: 1,
      errorCode: DATE_REJECTED,
      errorMessage:
        "Google News : 2 publications écartées par la vérification de la date (2 pages d'éditeur inaccessibles).",
    });
    expect(pages).toEqual([closed[0]!.url, closed[1]!.url]);
    expect((await created()).map((o) => [o.url, o.via])).toEqual([[twin.url, "perplexity"]]);
  });

  it("rattache au média les refus d'un de ses sous-domaines", async () => {
    const media = "https://www.grand-media.example";
    const closed = ["un", "deux", "trois"].map((n) => ({
      ...blocked(`sous-domaine ${n}`),
      url: `https://bourse.grand-media.example/sous-domaine-${n}`,
      media,
    }));
    const { run, pages } = await collectCounting(closed);
    expect(pages).toEqual([closed[0]!.url, closed[1]!.url]);
    expect(run.errorMessage).toContain("3 pages d'éditeur inaccessibles");
  });

  it("ne ferme pas un média pour les refus d'un hôte sans rapport avec lui", async () => {
    const closed = ["un", "deux", "trois"].map((n) => ({
      ...blocked(`hébergeur ${n}`),
      url: `https://hebergeur-tiers.example/hebergeur-${n}`,
      media: `https://www.${HOST}`,
    }));
    const readable = fresh("page du média annoncé");
    const { run, pages } = await collectCounting([...closed, readable]);
    expect(pages).toEqual([...closed, readable].map((a) => a.url));
    expect(run.newObservations).toBe(1);
  });

  it("recommence à chaque collecte : un refus n'est pas mémorisé", async () => {
    const closed = [blocked("mémoire un"), blocked("mémoire deux"), blocked("mémoire trois")];
    await collect(closed);
    await collect(closed);
    expect(pageRequests()).toEqual([closed[0]!.url, closed[1]!.url]);
  });
});

/** Observations créées par ces tests : titre, adresse, provenance et date. */
async function created() {
  const all = await (await getRepository()).observations.list();
  return all
    .filter((o) => o.title.includes("KORA-MOTIFS"))
    .map((o) => ({ title: o.title, url: o.url, via: o.via ?? null, publishedAt: o.publishedAt }));
}

describe("article non vérifiable : reprise de la version Perplexity", () => {
  beforeEach(() => setup());
  afterEach(teardown);

  it.each<[string, Article]>([
    ["page d'éditeur inaccessible", blocked("refus 403 repris")],
    ["page sans date lisible", article("sans date repris", page())],
    ["lien non résolu", article("lien non résolu repris", page(isoAgo(2)), null)],
  ])("%s : l'article entre par Perplexity, sans avertissement", async (_label, lost) => {
    const twin = samePerplexity(lost);
    const run = await collect([lost], { perplexity: [twin] });
    expect(outcome(run)).toEqual({
      status: "succes",
      newObservations: 1,
      errorCode: null,
      errorMessage: null,
    });
    expect(run.enrichment).toMatchObject({ status: "ok", received: 1, matched: 1, added: 1 });
    expect(await created()).toEqual([
      { title: lost.title, url: twin.url, via: "perplexity", publishedAt: twin.date },
    ]);
  });

  it("reprend aussi un article non examiné au-delà de la limite de vérifications", async () => {
    const archives = Array.from({ length: MAX_GOOGLE_NEWS_CHECKS }, (_, n) => old(`archive ${n}`));
    const beyond = fresh("hors limite repris");
    const twin = samePerplexity(beyond);
    const run = await collect([...archives, beyond], { perplexity: [twin] });
    expect(outcome(run)).toEqual({
      status: "succes",
      newObservations: 1,
      errorCode: DATE_REJECTED,
      errorMessage: `Google News : ${MAX_GOOGLE_NEWS_CHECKS} publications écartées par la vérification de la date (${MAX_GOOGLE_NEWS_CHECKS} hors de la fenêtre de 30 jours).`,
    });
    expect((await created()).map((o) => [o.url, o.via])).toEqual([[twin.url, "perplexity"]]);
  });

  it("garde l'article Google News quand sa date est confirmée : pas de doublon Perplexity", async () => {
    const confirmed = fresh("confirmé et vu par Perplexity");
    const run = await collect([confirmed], { perplexity: [samePerplexity(confirmed)] });
    expect(outcome(run)).toMatchObject({ status: "succes", newObservations: 1, errorCode: null });
    expect(run.enrichment).toMatchObject({ matched: 1, added: 0 });
    expect(await created()).toEqual([
      { title: confirmed.title, url: confirmed.url, via: "google_news", publishedAt: isoAgo(3) },
    ]);
  });

  it("écarte l'article quand la page le date hors fenêtre, même si Perplexity le dit récent", async () => {
    const archive = old("archive vue récente par Perplexity");
    const run = await collect([archive], { perplexity: [samePerplexity(archive)] });
    expect(outcome(run)).toEqual({
      status: "succes_sans_actualite",
      newObservations: 0,
      errorCode: DATE_REJECTED,
      errorMessage:
        "Google News : 1 publication écartée par la vérification de la date (1 hors de la fenêtre de 30 jours).",
    });
    expect(await created()).toEqual([]);
  });

  it("ne reprend pas une version Perplexity de plus de 30 jours", async () => {
    const lost = blocked("refus 403 et reprise trop ancienne");
    const run = await collect([lost], { perplexity: [samePerplexity(lost, 45)] });
    expect(outcome(run)).toEqual({
      status: "succes_sans_actualite",
      newObservations: 0,
      errorCode: DATE_REJECTED,
      errorMessage:
        "Google News : 1 publication écartée par la vérification de la date (1 page d'éditeur inaccessible).",
    });
    expect(await created()).toEqual([]);
  });

  it("ajoute sans réserve un résultat Perplexity que Google News n'a pas trouvé", async () => {
    const lost = blocked("refus 403 sans reprise");
    const other = samePerplexity(article("autre sujet trouvé par Perplexity seul", page()));
    const run = await collect([lost], { perplexity: [other] });
    expect(outcome(run)).toEqual({
      status: "succes",
      newObservations: 1,
      errorCode: DATE_REJECTED,
      errorMessage:
        "Google News : 1 publication écartée par la vérification de la date (1 page d'éditeur inaccessible).",
    });
    expect((await created()).map((o) => [o.url, o.via])).toEqual([[other.url, "perplexity"]]);
  });
});

describe("mergeEnrichment : réserve d'un doublon", () => {
  const item = (title: string, url: string, via: RawItem["via"]): RawItem => ({
    url,
    title,
    html: "",
    outlet: { name: "x", domain: "x.example", brand: { initials: "X", bg: "#000", fg: "#fff" } },
    publishedAt: isoAgo(1),
    eventDate: null,
    ...(via ? { via } : {}),
  });
  const TITLE = "Pasqal ouvre un laboratoire de recherche à Grenoble";
  const google = item(TITLE, "https://news.google.com/rss/articles/a", "google_news");

  it("met de côté le doublon sur l'élément qu'il double, sans l'ajouter à la liste", () => {
    const twin = item(`${TITLE} | Presse`, "https://presse.example/a", "perplexity");
    const alone = item(
      "Pasqal recrute trente ingénieurs en Isère",
      "https://presse.example/b",
      "perplexity",
    );
    expect(mergeEnrichment([google], [twin, alone])).toEqual([alone, { ...google, backup: twin }]);
  });

  it("ne garde qu'une réserve par élément : la première", () => {
    const first = item(TITLE, "https://presse.example/a", "perplexity");
    const second = item(TITLE, "https://autre.example/a", "perplexity");
    expect(mergeEnrichment([google], [first, second])).toEqual([{ ...google, backup: first }]);
  });

  it("laisse la liste inchangée sans résultat complémentaire", () => {
    expect(mergeEnrichment([google], [])).toEqual([google]);
  });
});

describe("checkPublishedAt : motif du refus", () => {
  const URL_OK = "https://www.presse-motifs.example/article";

  async function check(body: Article["page"], url = URL_OK) {
    stubPages([{ title: "", url, page: body }]);
    return checkPublishedAt(url, NOW);
  }

  it("rend la date originale quand elle est dans la fenêtre", async () => {
    const published = isoAgo(3);
    expect(await check(page(published))).toEqual({ ok: true, publishedAt: published });
  });

  it.each<[string, Article["page"]]>([
    ["erreur HTTP 403", () => new Response("refusé", { status: 403 })],
    [
      "redirection",
      () => new Response(null, { status: 302, headers: { location: "https://ailleurs.example/" } }),
    ],
    [
      "type autre que du HTML",
      () => new Response("%PDF", { headers: { "content-type": "application/pdf" } }),
    ],
    [
      "erreur réseau",
      () => {
        throw new TypeError("fetch failed");
      },
    ],
  ])("inaccessible : %s", async (_label, body) => {
    expect(await check(body)).toMatchObject({ ok: false, reason: "inaccessible" });
  });

  it.each<[number, boolean]>([
    [401, true],
    [403, true],
    [429, true],
    [404, false],
    [410, false],
    [500, false],
    [503, false],
  ])("inaccessible : HTTP %i, refus d'accès : %s", async (status, refused) => {
    expect(await check(() => new Response("non", { status }))).toEqual({
      ok: false,
      reason: "inaccessible",
      refused,
    });
  });

  it.each<[string, Article["page"]]>([
    [
      "redirection",
      () => new Response(null, { status: 302, headers: { location: "https://ailleurs.example/" } }),
    ],
    [
      "erreur réseau",
      () => {
        throw new TypeError("fetch failed");
      },
    ],
  ])("inaccessible sans refus d'accès : %s", async (_label, body) => {
    expect(await check(body)).toEqual({ ok: false, reason: "inaccessible", refused: false });
  });

  it("inaccessible : adresse interne, jamais demandée", async () => {
    expect(await check(page(isoAgo(3)), "http://127.0.0.1/article")).toEqual({
      ok: false,
      reason: "inaccessible",
      refused: false,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each<[string, string]>([
    ["page sans date", page()],
    ["page vide", ""],
    [
      "dates contradictoires",
      `${page(isoAgo(3))}<meta property="article:published_time" content="${isoAgo(9)}" />`,
    ],
  ])("sans_date : %s", async (_label, body) => {
    expect(await check(body)).toEqual({ ok: false, reason: "sans_date", refused: false });
  });

  it.each<[string, string]>([
    ["publication de 60 jours", isoAgo(60)],
    ["date dans le futur", isoAgo(-3)],
  ])("hors_fenetre : %s", async (_label, published) => {
    expect(await check(page(published))).toEqual({
      ok: false,
      reason: "hors_fenetre",
      refused: false,
    });
  });
});
