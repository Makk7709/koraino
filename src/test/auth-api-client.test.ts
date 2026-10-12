import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabaseAuth = vi.hoisted(() => ({
  getSession: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: supabaseAuth } }));

import { ApiError, api, apiFetch } from "@/lib/api/client";
import { setAuthModeForTests } from "@/lib/auth/mode";
import { takeAuthNotice } from "@/lib/auth/notice";
import { setLoginNavigatorForTests } from "@/lib/auth/token";

type Route = (url: string, init: RequestInit) => Response;

const json = (body: unknown, status = 200) => Response.json(body, { status });
const unauthenticated = () =>
  json(
    {
      error: { code: "unauthenticated", message: "Session absente ou expirée : reconnectez-vous." },
    },
    401,
  );

let fetchMock: ReturnType<typeof vi.fn<(url: string, init: RequestInit) => Promise<Response>>>;
let navigate: ReturnType<typeof vi.fn<(href: string) => void>>;

function serve(route: Route) {
  fetchMock = vi.fn(async (url: string, init: RequestInit) => route(url, init));
  vi.stubGlobal("fetch", fetchMock);
}

function sentHeaders(index = 0): Headers {
  const call = fetchMock.mock.calls[index];
  if (!call) throw new Error(`Aucun appel fetch n°${index}`);
  return new Headers(call[1].headers);
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  navigate = vi.fn<(href: string) => void>();
  setLoginNavigatorForTests(navigate);
  supabaseAuth.getSession.mockResolvedValue({
    data: { session: { access_token: "jeton-123" } },
    error: null,
  });
  supabaseAuth.signOut.mockResolvedValue({ error: null });
  window.history.replaceState(null, "", "/signaux?id=s1");
  window.sessionStorage.clear();
});

afterEach(() => {
  setAuthModeForTests(null);
  setLoginNavigatorForTests(null);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("apiFetch — mode supabase", () => {
  beforeEach(() => setAuthModeForTests("supabase"));

  it("ajoute le jeton de session en Authorization: Bearer", async () => {
    serve(() => json([]));
    await api.users();
    const headers = sentHeaders();
    expect(headers.get("authorization")).toBe("Bearer jeton-123");
    expect(headers.get("x-kora-request")).toBe("1");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/users");
  });

  it("n'ajoute rien sans session Supabase", async () => {
    supabaseAuth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    serve(() => json({}));
    await apiFetch("/me");
    expect(sentHeaders().has("authorization")).toBe(false);
  });

  it("conserve un en-tête Authorization explicite", async () => {
    serve(() => json({ id: "u1" }));
    await api.openServerSession("jeton-explicite");
    expect(sentHeaders().get("authorization")).toBe("Bearer jeton-explicite");
    expect(supabaseAuth.getSession).not.toHaveBeenCalled();
  });

  it("sur 401 : déconnecte localement et redirige une seule fois vers /connexion", async () => {
    serve(() => unauthenticated());
    const first = apiFetch("/signals");
    const second = apiFetch("/dashboard");
    await expect(first).rejects.toMatchObject({ status: 401, code: "unauthenticated" });
    await expect(second).rejects.toBeInstanceOf(ApiError);
    await flush();

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/connexion?redirect=%2Fsignaux%3Fid%3Ds1");
    expect(supabaseAuth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(takeAuthNotice()?.code).toBe("unauthenticated");
  });

  it("ne redirige pas sur un 401 des routes /auth/*", async () => {
    serve(() => unauthenticated());
    await expect(api.openServerSession("expire")).rejects.toMatchObject({ status: 401 });
    await flush();
    expect(navigate).not.toHaveBeenCalled();
    expect(supabaseAuth.signOut).not.toHaveBeenCalled();
  });

  it("ne redirige pas depuis une page de connexion (pas de boucle)", async () => {
    window.history.replaceState(null, "", "/connexion?redirect=%2Fveille");
    serve(() => unauthenticated());
    await expect(apiFetch("/me")).rejects.toMatchObject({ status: 401 });
    await flush();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("sur 403 account_not_authorized : déconnecte et explique le refus", async () => {
    serve(() =>
      json({ error: { code: "account_not_authorized", message: "Compte retiré." } }, 403),
    );
    await expect(apiFetch("/me")).rejects.toMatchObject({ status: 403 });
    await flush();
    expect(navigate).toHaveBeenCalledWith("/connexion?redirect=%2Fsignaux%3Fid%3Ds1");
    expect(supabaseAuth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(takeAuthNotice()?.code).toBe("account_not_authorized");
  });

  it("ne redirige pas sur les autres erreurs", async () => {
    serve(() => json({ error: { code: "forbidden", message: "Action réservée." } }, 403));
    await expect(apiFetch("/users", { method: "POST" })).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
      message: "Action réservée.",
    });
    await flush();
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("apiFetch — mode demo", () => {
  it("n'interroge pas Supabase et n'envoie pas de jeton", async () => {
    setAuthModeForTests("demo");
    serve(() => json({ id: "u_sophie" }));
    await api.me();
    expect(sentHeaders().has("authorization")).toBe(false);
    expect(supabaseAuth.getSession).not.toHaveBeenCalled();
  });

  it("se replie sur demo quand /api/auth/config échoue", async () => {
    serve((url) => {
      if (url === "/api/auth/config") throw new TypeError("Failed to fetch");
      return json({ id: "u_sophie" });
    });
    await api.me();
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["/api/auth/config", "/api/me"]);
    expect(sentHeaders(1).has("authorization")).toBe(false);
    expect(supabaseAuth.getSession).not.toHaveBeenCalled();
  });

  it("lit le mode supabase depuis /api/auth/config", async () => {
    serve((url) => (url === "/api/auth/config" ? json({ mode: "supabase" }) : json({})));
    await api.me();
    expect(sentHeaders(1).get("authorization")).toBe("Bearer jeton-123");
  });
});
