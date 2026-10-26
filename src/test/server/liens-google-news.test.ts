import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CollectionRun, Paginated, Signal, SignalDetail, Source } from "@/lib/api/types";
import { setAdapters } from "@/server/adapters";
import type { RawItem } from "@/server/adapters/collector";
import {
  decodeEmbeddedUrl,
  decodeRequestBody,
  GoogleNewsLinkResolver,
  googleNewsArticleId,
  parseDecodeParams,
  parseDecodeResponse,
} from "@/server/adapters/google-news";
import { getRepository } from "@/server/store/memory";
import { call, NOW, setup, teardown } from "./helpers";

/** Identifiant à l'ancien format : message protobuf en base64 URL, l'adresse en clair. */
function legacyId(url: string): string {
  const body = new TextEncoder().encode(url);
  const bytes = new Uint8Array([0x08, 0x13, 0x22, body.length, ...body, 0xd2, 0x01, 0x00]);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const NEW_ID = "CBMiWkFVX3lxTE1uWGxhdGVzdC1pZC1zYW5zLWFkcmVzc2U";
const RSS_LINK = (id: string) => `https://news.google.com/rss/articles/${id}?oc=5`;
const ARTICLE = "https://www.lesechos.fr/pme-regions/auvergne-rhone-alpes/kalray-signe-1234567";

const PAGE_HTML = `<html><body><c-wiz data-n-a-id="${NEW_ID}" data-n-a-sg="AQ-sig-nature" data-n-a-ts="1761480000" class="x"></c-wiz></body></html>`;
const DECODE_RESPONSE = `)]}'\n\n[["wrb.fr","Fbv4je","[\\"garturlres\\",\\"${ARTICLE}\\",\\"${NEW_ID}\\"]",null,null,null,"generic"],["di",12],["af.httprm",12,"-1234",5]]`;

describe("liens Google News : décodage", () => {
  it("reconnaît un identifiant d'article dans les deux formes d'adresse", () => {
    expect(googleNewsArticleId(RSS_LINK("abc-DEF_123"))).toBe("abc-DEF_123");
    expect(googleNewsArticleId("https://news.google.com/articles/xyz?hl=fr")).toBe("xyz");
    expect(googleNewsArticleId("https://news.google.com/rss/search?q=kalray")).toBeNull();
    expect(googleNewsArticleId("https://www.lesechos.fr/articles/abc")).toBeNull();
    expect(googleNewsArticleId("pas une url")).toBeNull();
  });

  it("lit l'adresse embarquée dans un ancien identifiant, et rien dans un nouveau", () => {
    expect(decodeEmbeddedUrl(legacyId(ARTICLE))).toBe(ARTICLE);
    expect(decodeEmbeddedUrl(legacyId("http://127.0.0.1/admin"))).toBeNull();
    expect(decodeEmbeddedUrl(legacyId("https://news.google.com/articles/x"))).toBeNull();
    expect(decodeEmbeddedUrl(NEW_ID)).toBeNull();
    expect(decodeEmbeddedUrl("%%%")).toBeNull();
  });

  it("extrait les paramètres de la page et l'adresse de la réponse interne", () => {
    expect(parseDecodeParams(PAGE_HTML)).toEqual({
      signature: "AQ-sig-nature",
      timestamp: "1761480000",
    });
    expect(parseDecodeParams("<html>rien</html>")).toBeNull();
    const body = decodeRequestBody(NEW_ID, { signature: "AQ-sig-nature", timestamp: "1761480000" });
    expect(body.startsWith("f.req=")).toBe(true);
    const outer = JSON.parse(decodeURIComponent(body.slice("f.req=".length))) as unknown[][][];
    expect(outer[0]![0]![0]).toBe("Fbv4je");
    const inner = JSON.parse(outer[0]![0]![1] as string) as unknown[];
    expect(inner[0]).toBe("garturlreq");
    expect(inner.slice(2)).toEqual([NEW_ID, 1761480000, "AQ-sig-nature"]);
    expect(parseDecodeResponse(DECODE_RESPONSE)).toBe(ARTICLE);
    expect(parseDecodeResponse(')]}\'\n\n[["wrb.fr","Fbv4je",null]]')).toBeNull();
    expect(parseDecodeResponse("<html>erreur</html>")).toBeNull();
    expect(
      parseDecodeResponse(
        `)]}'\n[["wrb.fr","Fbv4je","[\\"garturlres\\",\\"http://10.0.0.1/\\"]"]]`,
      ),
    ).toBeNull();
  });

  it("résout sans réseau un ancien lien, avec deux requêtes un nouveau, et met en cache", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://news.google.com/articles/")) return new Response(PAGE_HTML);
      if (url.endsWith("/batchexecute") && init?.method === "POST") {
        expect(String(init.body)).toContain("garturlreq");
        return new Response(DECODE_RESPONSE);
      }
      return new Response("introuvable", { status: 404 });
    });
    const resolver = new GoogleNewsLinkResolver(fetchMock as unknown as typeof fetch);
    expect(await resolver.resolve(RSS_LINK(legacyId(ARTICLE)))).toBe(ARTICLE);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await resolver.resolve(RSS_LINK(NEW_ID))).toBe(ARTICLE);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await resolver.resolve(RSS_LINK(NEW_ID))).toBe(ARTICLE);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await resolver.resolve("https://www.lesechos.fr/direct")).toBeNull();
  });

  it("rend null, sans lever, quand Google refuse ou répond autre chose", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const refusing = new GoogleNewsLinkResolver(
      (async () => new Response("rate limited", { status: 429 })) as unknown as typeof fetch,
    );
    expect(await refusing.resolve(RSS_LINK(NEW_ID))).toBeNull();
    const failing = new GoogleNewsLinkResolver((async () => {
      throw new Error("réseau coupé");
    }) as unknown as typeof fetch);
    expect(await failing.resolve(RSS_LINK(NEW_ID))).toBeNull();
    const odd = new GoogleNewsLinkResolver(
      (async () => new Response("<html>consentement</html>")) as unknown as typeof fetch,
    );
    expect(await odd.resolve(RSS_LINK(NEW_ID))).toBeNull();
  });
});

describe("liens Google News : collecte", () => {
  beforeEach(() => setup());
  afterEach(teardown);

  const outlet = {
    name: "Les Echos",
    domain: "lesechos.fr",
    brand: { initials: "L", bg: "#111", fg: "#fff" },
  };
  const item = (id: string, title: string, via: RawItem["via"] = "google_news"): RawItem => ({
    url: RSS_LINK(id),
    title,
    html: `<p>${title} pour accompagner sa croissance dans la région.</p>`,
    outlet,
    publishedAt: new Date(NOW.getTime() - 86_400_000).toISOString(),
    eventDate: null,
    via,
  });

  async function pasqalSource(): Promise<Source> {
    const res = await call<Source[]>("GET", "/sources?companyId=co_pasqal");
    return res.body.find((s) => s.type === "communiques")!;
  }

  async function observationUrls(q: string): Promise<string[]> {
    const list = await call<Paginated<Signal>>("GET", `/signals?q=${q}&status=tous`);
    const urls: string[] = [];
    for (const s of list.body.items) {
      const detail = await call<SignalDetail>("GET", `/signals/${s.id}`);
      urls.push(...detail.body.observations.map((o) => o.url));
    }
    return urls;
  }

  it("enregistre l'adresse de l'article quand la redirection se résout, la redirection sinon", async () => {
    const resolved = new Map([
      [RSS_LINK("ok1"), "https://www.lesechos.fr/pasqal-ouvre-un-centre"],
      [RSS_LINK("ok2"), "https://www.latribune.fr/pasqal-quantique-grenoble"],
    ]);
    const asked: string[] = [];
    setAdapters({
      links: {
        name: "stub",
        async resolve(url) {
          asked.push(url);
          return resolved.get(url) ?? null;
        },
      },
      collector: {
        name: "stub",
        collect: () => ({
          ok: true,
          items: [
            item("ok1", "Pasqal ouvre un centre quantique à Grenoble"),
            item("ko", "Pasqal lève des fonds auprès d'investisseurs européens"),
            item("pplx", "Pasqal recrute cinquante ingénieurs", "perplexity"),
            item("ok2", "Pasqal décroche un contrat avec un industriel"),
          ],
        }),
      },
    });
    const src = await pasqalSource();
    const run = await call<CollectionRun>("POST", `/sources/${src.id}/collect`);
    expect(run.body).toMatchObject({ status: "succes", newObservations: 4 });
    expect(asked).toEqual([RSS_LINK("ok1"), RSS_LINK("ko"), RSS_LINK("ok2")]);
    const urls = await observationUrls("Pasqal");
    expect(urls).toContain("https://www.lesechos.fr/pasqal-ouvre-un-centre");
    expect(urls).toContain("https://www.latribune.fr/pasqal-quantique-grenoble");
    expect(urls).toContain(RSS_LINK("ko"));
    expect(urls).toContain(RSS_LINK("pplx"));
    const signal = (await call<Paginated<Signal>>("GET", "/signals?q=centre quantique&status=tous"))
      .body.items[0]!;
    expect(signal.primaryUrl).toBe("https://www.lesechos.fr/pasqal-ouvre-un-centre");
  });

  it("ne résout que les redirections inconnues et écarte une adresse résolue déjà connue", async () => {
    const repo = await getRepository();
    const known = (await repo.observations.list())[0]!;
    const asked: string[] = [];
    setAdapters({
      links: {
        name: "stub",
        async resolve(url) {
          asked.push(url);
          return known.url;
        },
      },
      collector: {
        name: "stub",
        collect: () => ({
          ok: true,
          items: [
            { ...item("dup", "Pasqal reprise d'un article déjà connu"), url: known.url },
            item("same", "Pasqal : le même article sous une autre redirection"),
          ],
        }),
      },
    });
    const src = await pasqalSource();
    const run = await call<CollectionRun>("POST", `/sources/${src.id}/collect`);
    expect(run.body).toMatchObject({ status: "succes_sans_actualite", newObservations: 0 });
    expect(asked).toEqual([RSS_LINK("same")]);
  });
});
