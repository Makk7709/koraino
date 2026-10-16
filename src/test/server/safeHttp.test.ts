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
      vi.fn(async () => new Response(xml, { status: 200, headers: { "content-type": "text/xml" } })),
    );

    const text = await safeFetchText("https://news.google.com/rss/search?q=test");
    expect(text).toContain("<rss");
  });
});