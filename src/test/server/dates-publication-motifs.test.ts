/**
 * Motif des articles Google News écartés par la vérification de la date.
 *
 * Un article dont la date originale n'est pas confirmée n'est pas ingéré (voir
 * `dates-publication.test.ts`). Une source ne doit pas pour autant se vider sans explication :
 * la collecte porte l'avertissement `DATE_REJECTED`, avec le nombre d'articles écartés par
 * motif, visible dans l'historique des collectes ; ou `DATE_UNCHECKED` quand rien n'est
 * écarté mais que la vérification s'est arrêtée trop tôt. Aucun test n'appelle le réseau.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CollectionRun, Source } from "@/lib/api/types";
import { setAdapters } from "@/server/adapters";
import { RealCollector } from "@/server/adapters/collector";
import {
  DATE_REJECTED,
  DATE_UNCHECKED,
  GOOGLE_NEWS_DATE_BUDGET_MS,
  MAX_GOOGLE_NEWS_CHECKS,
  MAX_ITEMS,
} from "@/server/services/collection";
import { checkPublishedAt } from "@/server/services/publisher-page";
import { call, NOW, setup, teardown } from "./helpers";

const DAY = 86_400_000;
const isoAgo = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

interface Article {
  title: string;
  url: string;
  page: string | (() => Response);
  /** Adresse rendue par la résolution du lien Google News ; `null` : lien non résolu. */
  link?: string | null;
}

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
    url: `https://www.presse-motifs.example/${slug.replace(/[^a-z0-9]+/gi, "-")}`,
    page: body,
    ...(link === undefined ? {} : { link }),
  };
}

const fresh = (slug: string) => article(slug, page(isoAgo(3)));
const old = (slug: string) => article(slug, page(isoAgo(60)));
const blocked = (slug: string, status = 403) =>
  article(slug, () => new Response("refusé", { status }));

function stubPages(articles: Article[], rss = "") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("news.google.com/rss/search")) return new Response(rss);
      const found = articles.find((a) => a.url === url);
      if (!found) return new Response("introuvable", { status: 404 });
      return typeof found.page === "function" ? found.page() : htmlResponse(found.page);
    }),
  );
}

/** Collecte de la source Google News de Pasqal, sur un flux et des pages simulés. */
async function collect(articles: Article[], onResolve?: () => void): Promise<CollectionRun> {
  const redirect = (index: number) => `https://news.google.com/rss/articles/motif${index}`;
  const items = articles.map(
    (a, index) => `<item>
  <title>${a.title} - Presse Motifs</title>
  <link>${redirect(index)}</link>
  <pubDate>${new Date(NOW.getTime() - (index + 1) * 60_000).toUTCString()}</pubDate>
  <description>${a.title}</description>
  <source url="https://www.presse-motifs.example">Presse Motifs</source>
</item>`,
  );
  stubPages(
    articles,
    `<?xml version="1.0"?><rss version="2.0"><channel>${items.join("\n")}</channel></rss>`,
  );
  setAdapters({
    collector: new RealCollector({}),
    links: {
      name: "liens-motifs-test",
      async resolve(url: string): Promise<string | null> {
        onResolve?.();
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
        () => {
          wall += GOOGLE_NEWS_DATE_BUDGET_MS / 2;
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
    expect(await check(body)).toEqual({ ok: false, reason: "inaccessible" });
  });

  it("inaccessible : adresse interne, jamais demandée", async () => {
    expect(await check(page(isoAgo(3)), "http://127.0.0.1/article")).toEqual({
      ok: false,
      reason: "inaccessible",
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
    expect(await check(body)).toEqual({ ok: false, reason: "sans_date" });
  });

  it.each<[string, string]>([
    ["publication de 60 jours", isoAgo(60)],
    ["date dans le futur", isoAgo(-3)],
  ])("hors_fenetre : %s", async (_label, published) => {
    expect(await check(page(published))).toEqual({ ok: false, reason: "hors_fenetre" });
  });
});
