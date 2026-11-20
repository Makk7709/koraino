import { afterEach, describe, expect, it, vi } from "vitest";
import { perplexitySearch } from "@/server/adapters/collector";
import type { CompanyRecord } from "@/server/store/records";

const company = { name: "Kalray", aliases: [], domain: "kalray.eu" } as unknown as CompanyRecord;
afterEach(() => vi.unstubAllGlobals());

describe("Perplexity personal credential", () => {
  it("uses the personal key for Search even when the managed connection is present", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ results: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await perplexitySearch(company, {
      PERPLEXITY_PERSONAL_API_KEY: "test-personal",
      LOVABLE_API_KEY: "test-managed",
      PERPLEXITY_API_KEY: "test-connection",
    });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("https://api.perplexity.ai/search", expect.objectContaining({
      method: "POST",
      headers: { Authorization: "Bearer test-personal", "Content-Type": "application/json" },
    }));
  });

  it("works without managed credentials and never retries a rejected key through the gateway", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("Invalid API key", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await perplexitySearch(company, { PERPLEXITY_PERSONAL_API_KEY: "test-personal" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.outcome.status).toBe("erreur");
    expect(result.outcome.message).toContain("HTTP 401");
  });
});