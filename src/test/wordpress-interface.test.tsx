import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: {} } }));

import { ApprovalPanel } from "@/components/articles/ApprovalPanel";
import { WordPressRefusal, WordPressRemoteState } from "@/components/articles/WordPressChannel";
import { useArticleWorkflow } from "@/components/articles/workflow";
import { WordPressTab } from "@/components/parametres/WordPressTab";
import { ApiError } from "@/lib/api/client";
import { setAuthModeForTests } from "@/lib/auth/mode";
import type { ArticleDetail, Role, WordPressStatus } from "@/lib/api/types";

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

const me = (roles: Role[]) => () =>
  Response.json({
    id: "u1",
    name: "Camille Martin",
    email: "camille@inovallee.fr",
    team: "Communication",
    roles,
    avatarUrl: null,
  });

const wpStatus = (over: Partial<WordPressStatus> = {}): WordPressStatus => ({
  mode: "reel",
  site: "https://site.test",
  missing: [],
  settings: { categoryMap: {}, defaultCategory: null },
  koraCategories: ["Levée de fonds", "Brevet"],
  ...over,
});

beforeAll(() => {
  // Radix Select s'appuie sur des API absentes de jsdom.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});

beforeEach(() => {
  routes = {};
  fetchMock.mockClear();
  setAuthModeForTests("demo");
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  setAuthModeForTests(null);
  vi.unstubAllGlobals();
});

function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: () => <>{ui}</> });
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      createRoute({ getParentRoute: () => rootRoute, path: "/parametres" }),
    ]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const article = (wordpress: Partial<ArticleDetail["wordpress"]> = {}): ArticleDetail =>
  ({
    id: "a1",
    signalId: null,
    companyId: null,
    origin: "kora",
    author: null,
    status: "approuve",
    currentVersion: 2,
    title: "Levée de fonds de 12 M€",
    excerpt: "",
    angles: [],
    plan: [],
    factChecks: [],
    approvals: [
      {
        id: "ap1",
        version: 2,
        channel: "wordpress",
        approvedBy: "Camille Martin",
        approvedAt: "2026-10-14T08:00:00Z",
        scheduledAt: null,
        valid: true,
        invalidatedAt: null,
        invalidatedReason: null,
      },
    ],
    wordpress: { remoteId: null, status: "aucun", lastSyncAt: null, editUrl: null, ...wordpress },
    createdAt: "2026-10-13T08:00:00Z",
    updatedAt: "2026-10-14T08:00:00Z",
    versions: [],
    signal: null,
    observations: [],
    publications: [],
  }) as ArticleDetail;

function Panel({ a }: { a: ArticleDetail }) {
  const workflow = useArticleWorkflow(a, false);
  return (
    <ApprovalPanel
      article={a}
      workflow={workflow}
      onApprove={() => {}}
      onReject={() => {}}
      onShowDossier={() => {}}
    />
  );
}

describe("Paramètres > WordPress", () => {
  it("explique la configuration manquante et ne teste la connexion que sur demande", async () => {
    routes["GET /api/me"] = me(["admin"]);
    routes["GET /api/wordpress"] = () =>
      Response.json(
        wpStatus({
          mode: "non_configure",
          site: null,
          missing: ["WORDPRESS_URL", "WORDPRESS_APP_PASSWORD"],
        }),
      );
    routes["GET /api/wordpress/check"] = () =>
      Response.json({
        ok: true,
        account: { id: 9, name: "kora-bot", roles: ["editor"] },
        canPublish: true,
        error: null,
      });
    renderWithProviders(<WordPressTab />);

    expect(await screen.findByText("Envoi vers WordPress désactivé")).toBeInTheDocument();
    const steps = screen.getByRole("list", { name: "Procédure de configuration" });
    expect(within(steps).getByText(/rôle/)).toHaveTextContent("Contributeur");
    expect(within(steps).getByText(/Mots de passe d'application/)).toBeInTheDocument();
    expect(within(steps).getAllByText("Manquante ou invalide")).toHaveLength(2);
    expect(within(steps).getAllByText("Renseignée")).toHaveLength(1);
    expect(within(steps).getByText("WORDPRESS_USERNAME")).toBeInTheDocument();

    const edit = await screen.findByRole("button", { name: /Modifier la correspondance/ });
    expect(edit).toBeDisabled();
    expect(calls("GET /api/wordpress/categories")).toHaveLength(0);

    expect(calls("GET /api/wordpress/check")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /Tester la connexion/ }));
    expect(await screen.findByText(/rôle du compte est trop élevé/)).toBeInTheDocument();
    expect(screen.getByText("kora-bot")).toBeInTheDocument();
    expect(screen.getByText("Éditeur")).toBeInTheDocument();
    expect(calls("GET /api/wordpress/check")).toHaveLength(1);
  });

  it("reste en lecture seule pour un non-administrateur", async () => {
    routes["GET /api/me"] = me(["validateur"]);
    routes["GET /api/wordpress"] = () =>
      Response.json(
        wpStatus({
          settings: {
            categoryMap: { "Levée de fonds": "levees" },
            defaultCategory: "actualit%c3%a9s",
          },
        }),
      );
    renderWithProviders(<WordPressTab />);

    expect(await screen.findByText("levees")).toBeInTheDocument();
    expect(screen.getByText("actualités")).toBeInTheDocument();
    expect(screen.getByText(/Consultation seule/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://site.test" })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
    expect(screen.queryByRole("button", { name: /Tester la connexion/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Modifier la correspondance/ })).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(calls("GET /api/wordpress/categories")).toHaveLength(0);
  });

  it("charge les catégories à la demande et enregistre des slugs", async () => {
    routes["GET /api/me"] = me(["admin"]);
    routes["GET /api/wordpress"] = () =>
      Response.json(
        wpStatus({
          settings: { categoryMap: { "Levée de fonds": "levees" }, defaultCategory: null },
        }),
      );
    routes["GET /api/wordpress/categories"] = () =>
      Response.json([
        { id: 1, slug: "actualites", name: "Actualités", parent: 0 },
        { id: 3, slug: "levees", name: "Levées de fonds", parent: 1 },
        { id: 4, slug: "brevets", name: "Brevets", parent: 1 },
      ]);
    let saved: unknown = null;
    routes["PUT /api/wordpress/settings"] = (init) => {
      saved = JSON.parse(String(init?.body));
      return Response.json(wpStatus({ settings: saved as WordPressStatus["settings"] }));
    };
    renderWithProviders(<WordPressTab />);

    fireEvent.click(await screen.findByRole("button", { name: /Modifier la correspondance/ }));
    const brevet = await screen.findByRole("combobox", {
      name: "Catégorie WordPress pour « Brevet »",
    });
    expect(
      screen.getByRole("combobox", { name: "Catégorie WordPress pour « Levée de fonds »" }),
    ).toHaveTextContent("Actualités › Levées de fonds");
    expect(brevet).toHaveTextContent("— aucune —");
    expect(screen.getByRole("button", { name: /Enregistrer/ })).toBeDisabled();

    fireEvent.keyDown(brevet, { key: "Enter" });
    const option = await screen.findByRole("option", { name: "Actualités › Brevets" });
    expect(screen.getByRole("option", { name: "— aucune —" })).toBeInTheDocument();
    fireEvent.click(option);
    await waitFor(() => expect(brevet).toHaveTextContent("Actualités › Brevets"));

    fireEvent.click(screen.getByRole("button", { name: /Enregistrer/ }));
    await waitFor(() =>
      expect(saved).toEqual({
        categoryMap: { "Levée de fonds": "levees", Brevet: "brevets" },
        defaultCategory: null,
      }),
    );
  });

  it("affiche une erreur propre si l'API WordPress ne répond pas (serveur non déployé)", async () => {
    routes["GET /api/me"] = me(["admin"]);
    renderWithProviders(<WordPressTab />);
    expect(
      await screen.findByText("La configuration WordPress n'a pas pu être chargée"),
    ).toBeInTheDocument();
    expect(screen.getByText(/HTTP 404/)).toBeInTheDocument();
  });
});

describe("Panneau de diffusion : canal WordPress", () => {
  const sendButton = () => screen.findByRole("button", { name: /brouillon WordPress/ });

  it("désactive l'envoi et renvoie vers les paramètres quand WordPress n'est pas configuré", async () => {
    routes["GET /api/me"] = me(["validateur"]);
    routes["GET /api/wordpress"] = () =>
      Response.json(wpStatus({ mode: "non_configure", site: null, missing: ["WORDPRESS_URL"] }));
    routes["GET /api/audit?entity=article&entityId=a1&limit=30"] = () => Response.json([]);
    renderWithProviders(<Panel a={article()} />);

    await waitFor(async () => expect(await sendButton()).toBeDisabled());
    expect(await sendButton()).toHaveAttribute(
      "title",
      "WordPress n'est pas configuré : voir Paramètres > WordPress.",
    );
    expect(screen.getByRole("link", { name: /Paramètres > WordPress/ })).toHaveAttribute(
      "href",
      "/parametres?tab=wordpress",
    );
  });

  it("signale discrètement le mode démonstration", async () => {
    routes["GET /api/me"] = me(["validateur"]);
    routes["GET /api/wordpress"] = () => Response.json(wpStatus({ mode: "simule", site: null }));
    renderWithProviders(<Panel a={article()} />);
    expect(await screen.findByText(/Mode démonstration : brouillon simulé/)).toBeInTheDocument();
    expect(await sendButton()).toBeEnabled();
  });

  it("laisse l'envoi possible si le statut WordPress est indisponible (le serveur tranche)", async () => {
    routes["GET /api/me"] = me(["validateur"]);
    renderWithProviders(<Panel a={article()} />);
    await waitFor(() => expect(calls("GET /api/wordpress")).toHaveLength(1));
    expect(await sendButton()).toBeEnabled();
    expect(screen.queryByText(/n'est pas configuré/)).toBeNull();
  });
});

describe("État du brouillon distant", () => {
  it("affiche le statut, le lien d'édition et l'actualisation pour un validateur", async () => {
    routes["POST /api/articles/a1/wordpress/refresh"] = () =>
      Response.json(article({ remoteId: "123", status: "publie" }));
    const a = article({
      remoteId: "123",
      status: "en_attente",
      lastSyncAt: "2026-10-14T09:30:00Z",
      editUrl: "https://site.test/wp-admin/post.php?post=123&action=edit",
    });
    renderWithProviders(
      <WordPressRemoteState article={a} canRefresh refreshBlockedReason={null} />,
    );

    expect(await screen.findByText("En attente de relecture")).toBeInTheDocument();
    expect(screen.getByText(/Dernière synchronisation/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Ouvrir dans WordPress/ });
    expect(link).toHaveAttribute(
      "href",
      "https://site.test/wp-admin/post.php?post=123&action=edit",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");

    fireEvent.click(screen.getByRole("button", { name: /Actualiser le statut/ }));
    await waitFor(() => expect(calls("POST /api/articles/a1/wordpress/refresh")).toHaveLength(1));
  });

  it("masque l'actualisation sans brouillon ou sans droit de validation", async () => {
    renderWithProviders(
      <>
        <WordPressRemoteState article={article()} canRefresh refreshBlockedReason={null} />
        <WordPressRemoteState
          article={article({ remoteId: "9", status: "brouillon" })}
          canRefresh={false}
          refreshBlockedReason={null}
        />
      </>,
    );
    expect(await screen.findByText("Aucun brouillon WordPress")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Actualiser le statut/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Ouvrir dans WordPress/ })).toBeNull();
  });

  it("bloque l'actualisation quand WordPress n'est pas configuré", async () => {
    renderWithProviders(
      <WordPressRemoteState
        article={article({ remoteId: "9", status: "brouillon" })}
        canRefresh
        refreshBlockedReason="WordPress n'est pas configuré : voir Paramètres > WordPress."
      />,
    );
    expect(await screen.findByRole("button", { name: /Actualiser le statut/ })).toBeDisabled();
  });
});

describe("Refus d'un envoi WordPress", () => {
  it("liste les brouillons candidats avec leurs liens", async () => {
    const error = new ApiError(
      409,
      "publication_verification_required",
      "Plusieurs brouillons identiques existent sur WordPress : supprimez les doublons puis renvoyez.",
      {
        candidates: [
          {
            id: 101,
            title: "Levée de fonds de 12 M€",
            date: "2026-10-14T08:00:00Z",
            editUrl: "https://site.test/wp-admin/post.php?post=101&action=edit",
          },
          { id: 102, title: "Levée de fonds de 12 M€", editUrl: "javascript:alert(1)" },
        ],
      },
    );
    renderWithProviders(<WordPressRefusal error={error} editUrl={null} />);

    expect(
      await screen.findByText("Plusieurs brouillons identiques sur WordPress"),
    ).toBeInTheDocument();
    expect(screen.getByText(/supprimez les doublons/)).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Brouillons candidats" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    const links = within(list).getAllByRole("link", { name: /Ouvrir dans WordPress/ });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute(
      "href",
      "https://site.test/wp-admin/post.php?post=101&action=edit",
    );
    expect(links[0]).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("explique qu'un contenu publié se modifie dans WordPress", async () => {
    const error = new ApiError(
      409,
      "wordpress_remote_published",
      "Ce contenu a déjà été publié ou programmé sur WordPress : KORA ne le modifie plus.",
    );
    renderWithProviders(
      <WordPressRefusal
        error={error}
        editUrl="https://site.test/wp-admin/post.php?post=5&action=edit"
      />,
    );
    expect(
      await screen.findByText(
        /déjà en ligne ou programmé : la modification se fait dans WordPress/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Ouvrir dans WordPress/ })).toHaveAttribute(
      "target",
      "_blank",
    );
  });
});
