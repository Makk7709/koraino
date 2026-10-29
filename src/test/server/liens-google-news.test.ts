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

  it("annule le premier fetch, n'appelle pas le décodage, et laisse une tentative suivante aboutir", async () => {
    const calls: { url: string; signal: AbortSignal | undefined }[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, signal: init?.signal ?? undefined });
      if (url.startsWith("https://news.google.com/articles/")) {
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(new DOMException("The operation was aborted", "AbortError"));
            return;
          }
          signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted", "AbortError"));
          });
        });
      }
      return new Response(DECODE_RESPONSE);
    });
    const resolver = new GoogleNewsLinkResolver(fetchMock as unknown as typeof fetch);
    const ctrl = new AbortController();
    const pending = resolver.resolve(RSS_LINK(NEW_ID), ctrl.signal);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.startsWith("https://news.google.com/articles/")).toBe(true);
    expect(calls[0]!.signal?.aborted).toBe(false);
    ctrl.abort();
    await expect(pending).resolves.toBeNull();
    expect(calls[0]!.signal?.aborted).toBe(true);
    expect(calls).toHaveLength(1);

    fetchMock.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      calls.push({ url, signal: undefined });
      if (url.startsWith("https://news.google.com/articles/")) return new Response(PAGE_HTML);
      return new Response(DECODE_RESPONSE);
    });
    expect(await resolver.resolve(RSS_LINK(NEW_ID))).toBe(ARTICLE);
    expect(calls.filter((call) => call.url.endsWith("/batchexecute"))).toHaveLength(1);
    expect(await resolver.resolve(RSS_LINK(NEW_ID))).toBe(ARTICLE);
    expect(calls.filter((call) => call.url.endsWith("/batchexecute"))).toHaveLength(1);
  });

  it("n'annule pas une autre tentative sur la même adresse, et garde le cache d'un appel sans signal", async () => {
    const pages: { signal: AbortSignal; finish: () => void }[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/batchexecute")) return new Response(DECODE_RESPONSE);
      return new Promise<Response>((resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          resolve(new Response(PAGE_HTML));
          return;
        }
        signal.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted", "AbortError"));
        });
        pages.push({ signal, finish: () => resolve(new Response(PAGE_HTML)) });
      });
    });
    const resolver = new GoogleNewsLinkResolver(fetchMock as unknown as typeof fetch);
    const left = new AbortController();
    const right = new AbortController();
    const leftResult = resolver.resolve(RSS_LINK(NEW_ID), left.signal);
    const rightResult = resolver.resolve(RSS_LINK(NEW_ID), right.signal);
    expect(pages).toHaveLength(2);
    left.abort();
    expect(pages[0]!.signal.aborted).toBe(true);
    expect(pages[1]!.signal.aborted).toBe(false);
    pages[1]!.finish();
    expect(await leftResult).toBeNull();
    expect(await rightResult).toBe(ARTICLE);
    expect(await resolver.resolve(RSS_LINK(NEW_ID))).toBe(ARTICLE);
    expect(
      fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/batchexecute")),
    ).toHaveLength(1);

    const cached = new GoogleNewsLinkResolver(fetchMock as unknown as typeof fetch);
    const warm = cached.resolve(RSS_LINK(legacyId(ARTICLE)));
    expect(await warm).toBe(ARTICLE);
    const again = new AbortController();
    again.abort();
    expect(await cached.resolve(RSS_LINK(legacyId(ARTICLE)), again.signal)).toBe(ARTICLE);
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining(legacyId(ARTICLE)),
      expect.anything(),
    );
  });

  it("coupe seul une requête au bout de 8 secondes", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    let signal: AbortSignal | undefined;
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted", "AbortError"));
        });
      });
    });
    const resolver = new GoogleNewsLinkResolver(fetchMock as unknown as typeof fetch);
    try {
      const pending = resolver.resolve(RSS_LINK(NEW_ID));
      await vi.advanceTimersByTimeAsync(7_999);
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(signal?.aborted).toBe(true);
      await expect(pending).resolves.toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it("garde l'annulation active pendant le corps de la page et n'appelle pas le décodage", async () => {
    let pageSignal: AbortSignal | undefined;
    let cancelled = false;
    let release: () => void = () => {};
    const reading = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/batchexecute")) return new Response(DECODE_RESPONSE);
      pageSignal = init?.signal ?? undefined;
      return new Response(
        new ReadableStream({
          pull() {
            release();
          },
          cancel() {
            cancelled = true;
          },
        }),
      );
    });
    const resolver = new GoogleNewsLinkResolver(fetchMock as unknown as typeof fetch);
    const caller = new AbortController();
    const pending = resolver.resolve(RSS_LINK(NEW_ID), caller.signal);
    await reading;
    expect(pageSignal?.aborted).toBe(false);
    expect(cancelled).toBe(false);
    caller.abort();
    expect(pageSignal?.aborted).toBe(true);
    expect(cancelled).toBe(true);
    await expect(pending).resolves.toBeNull();
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/batchexecute"))).toBe(
      false,
    );
  });

  it("annule la lecture du corps batchexecute sans la mettre en cache, puis réessaie", async () => {
    let mode: "hang" | "ok" = "hang";
    let decodeSignal: AbortSignal | undefined;
    let cancelled = false;
    let release: () => void = () => {};
    const reading = new Promise<void>((resolve) => {
      release = resolve;
    });
    let decodeCalls = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://news.google.com/articles/")) return new Response(PAGE_HTML);
      decodeCalls += 1;
      decodeSignal = init?.signal ?? undefined;
      if (mode === "hang") {
        return new Response(
          new ReadableStream({
            pull() {
              release();
            },
            cancel() {
              cancelled = true;
            },
          }),
        );
      }
      return new Response(DECODE_RESPONSE);
    });
    const resolver = new GoogleNewsLinkResolver(fetchMock as unknown as typeof fetch);
    const caller = new AbortController();
    const pending = resolver.resolve(RSS_LINK(NEW_ID), caller.signal);
    await reading;
    expect(decodeSignal?.aborted).toBe(false);
    caller.abort();
    expect(decodeSignal?.aborted).toBe(true);
    expect(cancelled).toBe(true);
    await expect(pending).resolves.toBeNull();
    mode = "ok";
    expect(await resolver.resolve(RSS_LINK(NEW_ID))).toBe(ARTICLE);
    expect(decodeCalls).toBe(2);
    expect(await resolver.resolve(RSS_LINK(NEW_ID))).toBe(ARTICLE);
    expect(decodeCalls).toBe(2);
  });

  it("le délai de 8 secondes couvre la lecture du corps, pas seulement les en-têtes", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    let signal: AbortSignal | undefined;
    let cancelled = false;
    let release: () => void = () => {};
    const reading = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/batchexecute")) return new Response(DECODE_RESPONSE);
      signal = init?.signal ?? undefined;
      return new Response(
        new ReadableStream({
          pull() {
            release();
          },
          cancel() {
            cancelled = true;
          },
        }),
      );
    });
    const resolver = new GoogleNewsLinkResolver(fetchMock as unknown as typeof fetch);
    try {
      const pending = resolver.resolve(RSS_LINK(NEW_ID));
      await reading;
      await vi.advanceTimersByTimeAsync(7_999);
      expect(signal?.aborted).toBe(false);
      expect(cancelled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(signal?.aborted).toBe(true);
      expect(cancelled).toBe(true);
      await expect(pending).resolves.toBeNull();
      expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/batchexecute"))).toBe(
        false,
      );
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });
});

describe("liens Google News : collecte", () => {
  beforeEach(() => setup());
  afterEach(() => {
    teardown();
    vi.unstubAllGlobals();
  });

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

  it("enregistre l'adresse quand la page confirme la date, et écarte une redirection non résolue", async () => {
    const publishedAt = new Date(NOW.getTime() - 86_400_000).toISOString();
    const resolved = new Map([
      [RSS_LINK("ok1"), "https://www.lesechos.fr/pasqal-ouvre-un-centre"],
      [RSS_LINK("ok2"), "https://www.latribune.fr/pasqal-quantique-grenoble"],
    ]);
    const pages = new Set(resolved.values());
    const asked: string[] = [];
    const fetched: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      fetched.push(url);
      if (!pages.has(url)) return new Response("introuvable", { status: 404 });
      return new Response(
        `<script type="application/ld+json">${JSON.stringify({
          "@type": "NewsArticle",
          datePublished: publishedAt,
        })}</script>`,
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    });
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
    expect(run.body).toMatchObject({ status: "succes", newObservations: 3 });
    expect(asked).toEqual([RSS_LINK("ok1"), RSS_LINK("ko"), RSS_LINK("ok2")]);
    expect(fetched).toEqual([
      "https://www.lesechos.fr/pasqal-ouvre-un-centre",
      "https://www.latribune.fr/pasqal-quantique-grenoble",
    ]);
    const urls = await observationUrls("Pasqal");
    expect(urls).toContain("https://www.lesechos.fr/pasqal-ouvre-un-centre");
    expect(urls).toContain("https://www.latribune.fr/pasqal-quantique-grenoble");
    expect(urls).not.toContain(RSS_LINK("ko"));
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
