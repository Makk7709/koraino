import { afterEach, describe, expect, it, vi } from "vitest";
import { safeFetchText } from "@/server/domain/safeHttp";

afterEach(() => vi.unstubAllGlobals());

describe("safeFetchText (SSRF collecteur)", () => {
  it("refuse une redirection vers 127.0.0.1 avant de lire le corps", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const u = String(input);
      if (u.includes("example.com")) {
        return new Response(null, {
          status: 302,
          headers: { Location: "http://127.0.0.1/secret" },
        });
      }
      throw new Error("fetch ne devrait pas appeler 127.0.0.1");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      safeFetchText("https://example.com/feed", { headers: { accept: "text/xml" } }),
    ).rejects.toMatchObject({ code: "URL_REFUSED" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuse un port non standard", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(safeFetchText("https://example.com:8443/feed")).rejects.toMatchObject({
      code: "URL_REFUSED",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("lit un petit flux RSS valide", async () => {
    const xml = '<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>';
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(xml, { status: 200, headers: { "content-type": "text/xml" } }),
      ),
    );

    const text = await safeFetchText("https://news.google.com/rss/search?q=test");
    expect(text).toContain("<rss");
  });

  // A — C01 : les redirections vers des adresses internes sont refusées
  it.each([
    ["IPv4 privée", "http://10.0.0.1/"],
    ["métadonnées cloud", "http://169.254.169.254/"],
    ["IPv6 loopback", "http://[::1]/"],
    ["IPv6 privée", "http://[fd12:3456::1]/"],
    ["IPv4 loopback encodée en IPv6", "http://[::ffff:127.0.0.1]/"],
  ])("refuse une redirection vers une cible interne (%s)", async (_label, target) => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: target },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(safeFetchText("https://example.com/feed")).rejects.toMatchObject({
      code: "URL_REFUSED",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // B — Une redirection vers un autre domaine public est refusée
  it("refuse une redirection vers un autre domaine public", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: "https://evil.example.org/feed" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(safeFetchText("https://example.com/feed")).rejects.toMatchObject({
      code: "HOST_MISMATCH",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("refuse la première URL si l'hôte ne correspond pas à allowedHost", async () => {
    const fetchMock = vi.fn(async () => new Response("secret", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      safeFetchText("https://evil.example.org/feed", {
        allowedHost: "example.com",
      }),
    ).rejects.toMatchObject({ code: "HOST_MISMATCH" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  // C1 — Une redirection relative vers le même site fonctionne
  it("suit une redirection relative sur le même site", async () => {
    const xml = '<?xml version="1.0"?><rss><channel></channel></rss>';

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);

      if (url === "https://example.com/feed") {
        return new Response(null, {
          status: 302,
          headers: { Location: "/feed-final" },
        });
      }

      if (url === "https://example.com/feed-final") {
        return new Response(xml, {
          status: 200,
          headers: { "content-type": "text/xml" },
        });
      }

      throw new Error(`URL inattendue : ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(safeFetchText("https://example.com/feed")).resolves.toContain("<rss");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // C2 — La variante www est acceptée si elle est normalisée par le code
  it("accepte une redirection vers www du même domaine", async () => {
    const xml = "<rss><channel></channel></rss>";

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);

      if (url === "https://example.com/feed") {
        return new Response(null, {
          status: 302,
          headers: { Location: "https://www.example.com/feed-final" },
        });
      }

      if (url === "https://www.example.com/feed-final") {
        return new Response(xml, { status: 200 });
      }

      throw new Error(`URL inattendue : ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(safeFetchText("https://example.com/feed")).resolves.toContain("<rss");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // D — Redirection sans en-tête Location
  it("refuse une redirection sans en-tête Location", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 302 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(safeFetchText("https://example.com/feed")).rejects.toMatchObject({
      code: "REDIRECT_NO_LOCATION",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // E — Le nombre maximal de redirections est respecté
  it("refuse les redirections au-delà de la limite configurée", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: "/loop" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      safeFetchText("https://example.com/feed", { maxRedirects: 2 }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REDIRECTS" });

    // Deux redirections suivies, puis refus de la troisième.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  // F1 — La limite du corps est appliquée même en flux
  it("refuse un corps qui dépasse maxBytes", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(101));
        controller.close();
      },
    });

    const fetchMock = vi.fn(async () => new Response(body, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      safeFetchText("https://example.com/feed", { maxBytes: 100 }),
    ).rejects.toMatchObject({ code: "BODY_TOO_LARGE" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // F2 — Content-Length permet de refuser un corps avant sa lecture
  it("refuse un Content-Length supérieur à maxBytes", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, {
          status: 200,
          headers: { "content-length": "101" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      safeFetchText("https://example.com/feed", { maxBytes: 100 }),
    ).rejects.toMatchObject({ code: "BODY_TOO_LARGE" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // G — Timeout de la requête
  it("interrompt une requête qui dépasse le délai", async () => {
    const fetchMock = vi.fn(
      (_input: string | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;

          if (!signal) {
            reject(new Error("Signal d'annulation absent"));
            return;
          }

          if (signal.aborted) {
            reject(signal.reason);
            return;
          }

          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      safeFetchText("https://example.com/feed", { timeoutMs: 50 }),
    ).rejects.toMatchObject({ code: "TIMEOUT" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("interrompt la lecture du corps si le délai expire", async () => {
    const fetchMock = vi.fn((_input: string | URL, init?: RequestInit) => {
      const signal = init?.signal;
      if (!signal) {
        return Promise.reject(new Error("Signal d'annulation absent"));
      }

      const body = new ReadableStream<Uint8Array>({
        pull(_controller) {
          // Premier read() bloque jusqu'à abort (latence corps).
          return new Promise((_resolve, reject) => {
            if (signal.aborted) {
              reject(signal.reason);
              return;
            }
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
          });
        },
      });

      // En-têtes / Response OK immédiatement
      return Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { "content-type": "text/xml" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      safeFetchText("https://example.com/feed", { timeoutMs: 50 }),
    ).rejects.toMatchObject({ code: "TIMEOUT" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
