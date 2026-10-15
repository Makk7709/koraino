import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: {} } }));
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));

import { ConnectionCard } from "@/components/linkedin/ConnectionCard";
import {
  hasLinkedAccount,
  NO_CODE,
  OAUTH_FAILED,
  OAUTH_FAILURES,
  POPUP_BLOCKED,
} from "@/components/linkedin/connection";
import { setAuthModeForTests } from "@/lib/auth/mode";

type Handler = (init: RequestInit | undefined) => Response;

let routes: Record<string, Handler> = {};
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  const handler = routes[`${init?.method ?? "GET"} ${url}`];
  return handler
    ? handler(init)
    : Response.json({ error: { code: "not_found", message: "Route inconnue" } }, { status: 404 });
});
const calls = (key: string) =>
  fetchMock.mock.calls.filter(([url, init]) => `${init?.method ?? "GET"} ${url}` === key);

beforeEach(() => {
  routes = {};
  fetchMock.mockClear();
  toastError.mockClear();
  setAuthModeForTests("demo");
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  setAuthModeForTests(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ConnectionCard />
    </QueryClientProvider>,
  );
}

/** Fenêtre de consentement factice : `postMessage` simule la page de retour. */
function fakePopup() {
  const popup = { closed: false, close: vi.fn(), location: { href: "" } };
  vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
  return {
    popup,
    reply(data: Record<string, unknown>) {
      const event = new MessageEvent("message", { origin: window.location.origin, data });
      Object.defineProperty(event, "source", { value: popup });
      act(() => {
        window.dispatchEvent(event);
      });
    },
  };
}

const startConnect = () => {
  routes["POST /api/me/linkedin/connect"] = () =>
    Response.json({ authorizationUrl: "https://gateway.test/authorize", state: "etat-1" });
};

describe("carte de connexion LinkedIn", () => {
  it("LinkedIn indisponible : compte relié affiché comme tel, avec « Réessayer »", async () => {
    let answer = { connected: false, error: "linkedin_unavailable" } as Record<string, unknown>;
    routes["GET /api/me/linkedin"] = () => Response.json(answer);
    renderCard();

    expect(await screen.findByText(/LinkedIn ne répond pas pour le moment/)).toBeInTheDocument();
    expect(screen.queryByText(/Aucun compte LinkedIn relié/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Connecter mon compte/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Déconnecter/ })).toBeInTheDocument();

    answer = { connected: true, name: "Camille Martin" };
    fireEvent.click(screen.getByRole("button", { name: /Réessayer/ }));
    expect(await screen.findByText("Camille Martin")).toBeInTheDocument();
    expect(calls("GET /api/me/linkedin")).toHaveLength(2);
  });

  it("fenêtre bloquée par le navigateur : message explicite, aucune demande au serveur", async () => {
    routes["GET /api/me/linkedin"] = () => Response.json({ connected: false });
    vi.spyOn(window, "open").mockReturnValue(null);
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: /Connecter mon compte LinkedIn/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(POPUP_BLOCKED));
    expect(calls("POST /api/me/linkedin/connect")).toHaveLength(0);
  });

  it("accès hors ligne désactivé : le motif est expliqué, rien n'est échangé", async () => {
    routes["GET /api/me/linkedin"] = () => Response.json({ connected: false });
    startConnect();
    const { popup, reply } = fakePopup();
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: /Connecter mon compte LinkedIn/ }));
    await waitFor(() => expect(popup.location.href).toBe("https://gateway.test/authorize"));
    reply({
      type: "appUserConnectorOAuthFailed",
      connectorId: "linkedin",
      code: null,
      error: "offline_access_disabled",
    });
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(OAUTH_FAILURES["offline_access_disabled"]),
    );
    expect(popup.close).toHaveBeenCalled();
    expect(calls("POST /api/me/linkedin/complete")).toHaveLength(0);
  });

  it("motif inconnu : message générique, jamais le texte brut reçu", async () => {
    routes["GET /api/me/linkedin"] = () => Response.json({ connected: false });
    startConnect();
    const { popup, reply } = fakePopup();
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: /Connecter mon compte LinkedIn/ }));
    await waitFor(() => expect(popup.location.href).not.toBe(""));
    reply({ type: "appUserConnectorOAuthFailed", connectorId: "linkedin", error: "<b>x</b>" });
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(OAUTH_FAILED));
  });

  it("retour sans code : message au lieu d'un échec silencieux", async () => {
    routes["GET /api/me/linkedin"] = () => Response.json({ connected: false });
    startConnect();
    const { popup, reply } = fakePopup();
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: /Connecter mon compte LinkedIn/ }));
    await waitFor(() => expect(popup.location.href).not.toBe(""));
    reply({ type: "appUserConnectorOAuthComplete", connectorId: "linkedin", code: null });
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(NO_CODE));
    expect(calls("POST /api/me/linkedin/complete")).toHaveLength(0);
  });

  it("un compte est relié dès qu'une clé est enregistrée, même si LinkedIn ne répond pas", () => {
    expect(hasLinkedAccount(undefined)).toBe(false);
    expect(hasLinkedAccount({ connected: false })).toBe(false);
    expect(hasLinkedAccount({ connected: true })).toBe(true);
    expect(hasLinkedAccount({ connected: false, reconnectRequired: true })).toBe(true);
    expect(hasLinkedAccount({ connected: false, error: "linkedin_unavailable" })).toBe(true);
  });
});
