import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (event: AuthChangeEvent, session: Session | null) => void;

const supabaseAuth = vi.hoisted(() => ({
  getSession: vi.fn(),
  signOut: vi.fn(),
  signInWithPassword: vi.fn(),
  onAuthStateChange: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: supabaseAuth } }));

import { AuthGate } from "@/components/auth/AuthGate";
import { setAuthModeForTests } from "@/lib/auth/mode";
import { resetAuthStoreForTests, signInWithPassword, useAuth } from "@/lib/auth/session";
import { setLoginNavigatorForTests } from "@/lib/auth/token";

const session = {
  access_token: "jeton-abc",
  refresh_token: "r",
  expires_in: 3600,
  token_type: "bearer",
  user: { id: "auth-1", email: "camille@inovallee.fr" },
} as unknown as Session;

const koraUser = {
  id: "u_camille",
  name: "Camille Martin",
  email: "camille@inovallee.fr",
  team: "Communication",
  roles: ["redacteur"],
  avatarUrl: null,
  hasAccount: true,
};

let listener: Listener | null = null;
let sessionResponse: () => Response;
let fetchMock: ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>;

function emit(event: AuthChangeEvent, s: Session | null) {
  if (!listener) throw new Error("onAuthStateChange n'a pas été appelé");
  act(() => listener?.(event, s));
}

const calls = (url: string) => fetchMock.mock.calls.filter((c) => c[0] === url);

beforeEach(() => {
  resetAuthStoreForTests();
  setAuthModeForTests("supabase");
  setLoginNavigatorForTests(vi.fn());
  window.sessionStorage.clear();
  listener = null;
  supabaseAuth.onAuthStateChange.mockImplementation((cb: Listener) => {
    listener = cb;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });
  supabaseAuth.getSession.mockResolvedValue({ data: { session }, error: null });
  supabaseAuth.signOut.mockResolvedValue({ error: null });
  sessionResponse = () => Response.json(koraUser);
  fetchMock = vi.fn(async (url: string) => {
    if (url === "/api/auth/session") return sessionResponse();
    if (url === "/api/auth/logout") return new Response(null, { status: 204 });
    return Response.json({});
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  setAuthModeForTests(null);
  setLoginNavigatorForTests(null);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("store d'authentification", () => {
  it("valide la session auprès du serveur (cookie kora_session)", async () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(listener).not.toBeNull());

    emit("INITIAL_SESSION", session);
    await waitFor(() => expect(result.current.verification).toBe("ok"));

    expect(result.current.user?.id).toBe("u_camille");
    const [call] = calls("/api/auth/session");
    const headers = new Headers(call?.[1]?.headers);
    expect(call?.[1]?.method).toBe("POST");
    expect(headers.get("authorization")).toBe("Bearer jeton-abc");
    expect(headers.get("x-kora-request")).toBe("1");

    emit("TOKEN_REFRESHED", session);
    await waitFor(() => expect(result.current.session).toBe(session));
    expect(calls("/api/auth/session")).toHaveLength(1);
  });

  it("déconnecte Supabase et explique un compte non autorisé (403)", async () => {
    sessionResponse = () =>
      Response.json(
        { error: { code: "account_not_authorized", message: "Votre compte n'est pas autorisé." } },
        { status: 403 },
      );
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(listener).not.toBeNull());

    emit("SIGNED_IN", session);
    await waitFor(() => expect(supabaseAuth.signOut).toHaveBeenCalledWith({ scope: "local" }));
    await waitFor(() => expect(result.current.session).toBeNull());
    expect(result.current.notice?.code).toBe("account_not_authorized");
  });

  it("efface le cookie serveur à la déconnexion", async () => {
    renderHook(() => useAuth());
    await waitFor(() => expect(listener).not.toBeNull());
    emit("SIGNED_OUT", null);
    await waitFor(() => expect(calls("/api/auth/logout")).toHaveLength(1));
    expect(calls("/api/auth/logout")[0]?.[1]?.method).toBe("POST");
  });

  it("refuse la connexion d'un compte non invité", async () => {
    sessionResponse = () =>
      Response.json(
        { error: { code: "account_not_authorized", message: "Non autorisé." } },
        { status: 403 },
      );
    supabaseAuth.signInWithPassword.mockResolvedValue({ data: { session }, error: null });
    const result = await signInWithPassword("camille@inovallee.fr", "secret-secret");
    expect(result).toEqual({
      ok: false,
      message:
        "Votre compte n'est pas autorisé sur KORA. Demandez à un administrateur de vous inviter.",
    });
    expect(supabaseAuth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("n'utilise pas Supabase en mode demo", async () => {
    setAuthModeForTests("demo");
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.mode).toBe("demo");
    expect(supabaseAuth.onAuthStateChange).not.toHaveBeenCalled();
  });
});

describe("AuthGate", () => {
  function renderGate(path: string) {
    const rootRoute = createRootRoute({
      component: () => (
        <AuthGate>
          <p>Contenu protégé</p>
        </AuthGate>
      ),
    });
    const routeTree = rootRoute.addChildren([
      createRoute({ getParentRoute: () => rootRoute, path: "/signaux" }),
      createRoute({ getParentRoute: () => rootRoute, path: "/connexion" }),
    ]);
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: [path] }),
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    return router;
  }

  it("redirige vers /connexion sans session, sans afficher le contenu", async () => {
    const router = renderGate("/signaux?id=s1");
    await waitFor(() => expect(listener).not.toBeNull());
    emit("INITIAL_SESSION", null);

    await waitFor(() => expect(router.state.location.pathname).toBe("/connexion"));
    expect(router.state.location.search).toEqual({ redirect: "/signaux?id=s1" });
    expect(screen.queryByText("Contenu protégé")).toBeNull();
  });

  it("affiche le contenu une fois la session validée", async () => {
    renderGate("/signaux");
    await waitFor(() => expect(listener).not.toBeNull());
    expect(screen.queryByText("Contenu protégé")).toBeNull();
    emit("INITIAL_SESSION", session);
    expect(await screen.findByText("Contenu protégé")).toBeInTheDocument();
  });

  it("laisse passer immédiatement en mode demo", async () => {
    setAuthModeForTests("demo");
    renderGate("/signaux");
    expect(await screen.findByText("Contenu protégé")).toBeInTheDocument();
    expect(supabaseAuth.onAuthStateChange).not.toHaveBeenCalled();
  });
});
