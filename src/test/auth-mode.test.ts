import { afterEach, describe, expect, it, vi } from "vitest";
import { getAuthMode, peekAuthMode, setAuthModeForTests } from "@/lib/auth/mode";

function stubFetch(impl: () => Promise<Response>) {
  const fn = vi.fn<(url: string) => Promise<Response>>(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  setAuthModeForTests(null);
  vi.unstubAllGlobals();
});

describe("getAuthMode", () => {
  it("lit le mode renvoyé par GET /api/auth/config et le met en cache", async () => {
    const fetchMock = stubFetch(async () => Response.json({ mode: "supabase" }));
    expect(await getAuthMode()).toBe("supabase");
    expect(await getAuthMode({ refresh: true })).toBe("supabase");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/auth/config");
    expect(peekAuthMode()).toBe("supabase");
  });

  it("regroupe les lectures simultanées", async () => {
    const fetchMock = stubFetch(async () => Response.json({ mode: "demo" }));
    const modes = await Promise.all([getAuthMode(), getAuthMode(), getAuthMode()]);
    expect(modes).toEqual(["demo", "demo", "demo"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["erreur réseau", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["404 (route absente)", async () => Response.json({ error: {} }, { status: 404 })],
    ["500", async () => new Response("oops", { status: 500 })],
    ["corps invalide", async () => Response.json({ mode: "admin" })],
    ["corps non JSON", async () => new Response("<html>", { status: 200 })],
  ])("se replie sur demo en cas de %s", async (_label, impl) => {
    stubFetch(impl);
    expect(await getAuthMode()).toBe("demo");
  });

  it("garde le repli pour l'interface mais relit le mode sur demande", async () => {
    const fetchMock = stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(await getAuthMode()).toBe("demo");
    expect(await getAuthMode()).toBe("demo");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockImplementation(async () => Response.json({ mode: "supabase" }));
    expect(await getAuthMode({ refresh: true })).toBe("supabase");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
