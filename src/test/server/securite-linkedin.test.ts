import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  authorizeAppUserOAuth,
  disconnectAppUser,
  exchangeAppUserOAuthCode,
} from "@/integrations/lovable/appUserConnector";
import type {
  ApiErrorBody,
  AuditEvent,
  LinkedInConnectStart,
  LinkedInPost,
  NewsletterEdition,
  PublicationAttempt,
} from "@/lib/api/types";
import {
  ConnectionKeyUnavailableError,
  deleteConnectionKeyForUser,
  getConnectionKeyForUser,
  saveConnectionKeyForUser,
} from "@/server/appUserConnections.server";
import { setClock } from "@/server/clock";
import { idempotencyKey } from "@/server/domain/workflow";
import { GATEWAY_BASE_URL } from "@/server/handlers/connectors";
import { setLinkedInUserPublisherForTests } from "@/server/handlers/distribution";
import { HttpError } from "@/server/http";
import { consumePendingConnect, PENDING_CONNECT_TTL_MS } from "@/server/linkedin/pendingConnect";
import type { Repository } from "@/server/store/repository";
import { Route as OAuthReturnRoute } from "@/routes/api/oauth/linkedin/return";
import { call, NOW, setup, teardown, USERS } from "./helpers";

vi.mock("@/server/appUserConnections.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/appUserConnections.server")>()),
  getConnectionKeyForUser: vi.fn(),
  saveConnectionKeyForUser: vi.fn(),
  deleteConnectionKeyForUser: vi.fn(),
}));

vi.mock("@/integrations/lovable/appUserConnector", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/integrations/lovable/appUserConnector")>()),
  authorizeAppUserOAuth: vi.fn(),
  exchangeAppUserOAuthCode: vi.fn(),
  disconnectAppUser: vi.fn(),
}));

type Publisher = NonNullable<Parameters<typeof setLinkedInUserPublisherForTests>[0]>;
type PublishResult = Awaited<ReturnType<Publisher>>;
type Reply = PublicationAttempt & ApiErrorBody;

const { admin: ADMIN, validateur: VALIDATOR, redacteur: EDITOR } = USERS;
/** Second validateur, non administrateur. */
const OTHER_VALIDATOR = "u_paul";
const POST_ID = "li_pasqal";
const NOT_PENDING_MESSAGE =
  "Aucune connexion LinkedIn n'est en attente pour votre compte (demande expirée ou déjà utilisée) : relancez « Connecter mon compte LinkedIn ».";
const KEY_UNAVAILABLE_MESSAGE =
  "Impossible de lire votre connexion LinkedIn pour le moment : réessayez plus tard.";
const UNREADABLE_REMOVED =
  "Connexion LinkedIn illisible supprimée sans révocation : l'accès reste à retirer dans LinkedIn (services autorisés)";
const DELETE_UNAVAILABLE_MESSAGE =
  "Connexion LinkedIn impossible à supprimer pour le moment : réessayez plus tard.";
const MAYBE_MESSAGE =
  "LinkedIn est momentanément indisponible (erreur 503) : le post a peut-être été publié.";
const MAYBE_PUBLISHED: PublishResult = {
  kind: "api_error",
  message: MAYBE_MESSAGE,
  verifyBeforeRetry: true,
};

let repo: Repository;

beforeEach(async () => {
  repo = setup();
  await repo.users.insert({
    id: OTHER_VALIDATOR,
    name: "Paul Girard",
    email: "paul.girard@inovallee.com",
    team: "Direction",
    roles: ["validateur"],
    avatarUrl: null,
  });
  vi.stubEnv("LINKEDIN_APP_USER_CONNECTOR_CLIENT_API_KEY", "cle-client-de-test");
  vi.stubGlobal("fetch", () => {
    throw new Error("aucun appel réseau réel dans les tests");
  });
  vi.mocked(getConnectionKeyForUser).mockReset().mockResolvedValue(null);
  vi.mocked(saveConnectionKeyForUser).mockReset().mockResolvedValue();
  vi.mocked(deleteConnectionKeyForUser).mockReset().mockResolvedValue();
  vi.mocked(authorizeAppUserOAuth)
    .mockReset()
    .mockResolvedValue({ authorizationUrl: "https://passerelle.test/oauth", sessionId: "s1" });
  vi.mocked(exchangeAppUserOAuthCode)
    .mockReset()
    .mockResolvedValue({ connectionAPIKey: "lovack_cle_de_test", connectorId: "linkedin" });
});

afterEach(() => {
  setLinkedInUserPublisherForTests(null);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  teardown();
});

/* ------------------------------------------------------------------ */
/* F3 — connexion OAuth                                                */
/* ------------------------------------------------------------------ */

async function connect(user: string): Promise<string> {
  const res = await call<LinkedInConnectStart>("POST", "/me/linkedin/connect", { user });
  expect(res.status).toBe(200);
  expect(res.body.authorizationUrl).toBe("https://passerelle.test/oauth");
  expect(res.body.state).toEqual(expect.any(String));
  return res.body.state;
}

const complete = (user: string, body: Record<string, unknown>) =>
  call<{ ok: boolean } & ApiErrorBody>("POST", "/me/linkedin/complete", { user, body });

function expectNotPending(res: Awaited<ReturnType<typeof complete>>) {
  expect(res.status).toBe(409);
  expect(res.body.error).toEqual({
    code: "linkedin_connect_not_pending",
    message: NOT_PENDING_MESSAGE,
  });
}

describe("F3 — connexion LinkedIn : attente côté serveur liée à l'utilisateur", () => {
  it("connect ouvre une attente, complete la consomme et enregistre la clé de CET utilisateur", async () => {
    const state = await connect(VALIDATOR);
    expect(authorizeAppUserOAuth).toHaveBeenCalledWith(
      expect.objectContaining({ appUserId: VALIDATOR }),
    );

    const res = await complete(VALIDATOR, { code: "code-1", state });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(exchangeAppUserOAuthCode).toHaveBeenCalledWith(GATEWAY_BASE_URL, "code-1");
    expect(saveConnectionKeyForUser).toHaveBeenCalledWith(
      VALIDATOR,
      "linkedin",
      "lovack_cle_de_test",
    );
  });

  it("sans connexion en attente : 409, aucun code échangé", async () => {
    for (const body of [
      { code: "code-injecte" },
      { code: "code-injecte", state: "" },
      { code: "code-injecte", state: 42 },
      { code: "code-injecte", state: "inconnu.jeton" },
      { code: "code-injecte", state: "../../autre:clé" },
    ]) {
      expectNotPending(await complete(VALIDATOR, body));
    }
    expect(exchangeAppUserOAuthCode).not.toHaveBeenCalled();
    expect(saveConnectionKeyForUser).not.toHaveBeenCalled();
  });

  it("l'attente d'un autre utilisateur est refusée (409) et reste valable pour son auteur", async () => {
    const state = await connect(VALIDATOR);
    expectNotPending(await complete(EDITOR, { code: "code-de-lucas", state }));
    expect(exchangeAppUserOAuthCode).not.toHaveBeenCalled();

    expect((await complete(VALIDATOR, { code: "code-de-claire", state })).status).toBe(200);
    expect(vi.mocked(saveConnectionKeyForUser).mock.calls).toEqual([
      [VALIDATOR, "linkedin", "lovack_cle_de_test"],
    ]);
  });

  it("une attente n'est consommable qu'une fois", async () => {
    const state = await connect(VALIDATOR);
    expect((await complete(VALIDATOR, { code: "code-1", state })).status).toBe(200);
    expectNotPending(await complete(VALIDATOR, { code: "code-2", state }));
    expect(exchangeAppUserOAuthCode).toHaveBeenCalledTimes(1);
  });

  it("deux finalisations simultanées : une seule consomme l'attente", async () => {
    const state = await connect(VALIDATOR);
    const results = await Promise.all([
      complete(VALIDATOR, { code: "code-1", state }),
      complete(VALIDATOR, { code: "code-2", state }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(exchangeAppUserOAuthCode).toHaveBeenCalledTimes(1);
  });

  it("attente expirée après 10 minutes : 409", async () => {
    const early = await connect(VALIDATOR);
    setClock(() => new Date(NOW.getTime() + PENDING_CONNECT_TTL_MS - 1));
    expect((await complete(VALIDATOR, { code: "code-1", state: early })).status).toBe(200);

    const late = await connect(VALIDATOR);
    setClock(() => new Date(NOW.getTime() + 2 * PENDING_CONNECT_TTL_MS - 1));
    expectNotPending(await complete(VALIDATOR, { code: "code-2", state: late }));
    expect(exchangeAppUserOAuthCode).toHaveBeenCalledTimes(1);
  });

  it("jeton falsifié : 409, l'attente reste valable", async () => {
    const state = await connect(VALIDATOR);
    const forged = state.slice(0, -1) + (state.endsWith("0") ? "1" : "0");
    expectNotPending(await complete(VALIDATOR, { code: "code-1", state: forged }));
    expect((await complete(VALIDATOR, { code: "code-2", state })).status).toBe(200);
  });

  it("N5 — un nouveau clic « Connecter » remplace l'attente précédente", async () => {
    const first = await connect(VALIDATOR);
    const second = await connect(VALIDATOR);
    expectNotPending(await complete(VALIDATOR, { code: "code-1", state: first }));
    expect((await complete(VALIDATOR, { code: "code-2", state: second })).status).toBe(200);
    expect(vi.mocked(exchangeAppUserOAuthCode).mock.calls).toEqual([[GATEWAY_BASE_URL, "code-2"]]);
  });

  it("le code reste obligatoire (400) et n'entame pas l'attente", async () => {
    const state = await connect(VALIDATOR);
    const res = await complete(VALIDATOR, { state });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("missing_code");
    expect((await complete(VALIDATOR, { code: "code-1", state })).status).toBe(200);
  });
});

describe("F3 — page publique de retour OAuth", () => {
  const handler = (
    OAuthReturnRoute as unknown as {
      options: { server: { handlers: { GET: (a: { request: Request }) => Promise<Response> } } };
    }
  ).options.server.handlers.GET;

  it.each([
    ["succès", "success=true&code=code-secret&connector_id=linkedin"],
    ["échec", "success=false&error=access_denied&connector_id=linkedin"],
  ])("%s : ni cache ni Referer, message limité à l'origine de l'app", async (_label, query) => {
    const res = await handler({
      request: new Request(`https://kora.example/api/oauth/linkedin/return?${query}`),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toContain(
      "window.opener.postMessage(message, window.location.origin)",
    );
  });

  it("sans accès hors ligne : échec explicite, pas de succès sans code", async () => {
    const res = await handler({
      request: new Request(
        "https://kora.example/api/oauth/linkedin/return?success=true&offline_access_allowed=false&connector_id=linkedin",
      ),
    });
    const html = await res.text();
    expect(html).toContain('"success":false');
    expect(html).toContain('"error":"offline_access_disabled"');
    expect(html).toContain("error: result.error ?? null");
  });
});

/* ------------------------------------------------------------------ */
/* Publication : outils communs                                        */
/* ------------------------------------------------------------------ */

async function approvePost(): Promise<LinkedInPost> {
  const post = (await call<LinkedInPost[]>("GET", "/linkedin")).body.find((p) => p.id === POST_ID)!;
  const approved = await call<LinkedInPost>("POST", `/linkedin/${POST_ID}/approve`, {
    body: { version: post.version },
    user: VALIDATOR,
  });
  expect(approved.status).toBe(200);
  return approved.body;
}

const publish = (user: string, body?: { resolution: string }) =>
  call<Reply>("POST", `/linkedin/${POST_ID}/publish`, { user, ...(body ? { body } : {}) });

async function attemptsFor(): Promise<PublicationAttempt[]> {
  const list = await call<PublicationAttempt[]>("GET", "/publications?channel=linkedin");
  return list.body.filter((p) => p.linkedinPostId === POST_ID).reverse();
}

const getPost = async () => (await repo.linkedin.get(POST_ID))!;

/** Résultats servis dans l'ordre ; enregistre le compte utilisé à chaque appel. */
function queuedPublisher(...results: PublishResult[]) {
  const calls: string[] = [];
  const fn: Publisher = async (userId) => {
    calls.push(userId);
    return results.shift() ?? { kind: "published", remoteId: "urn:li:share:9999" };
  };
  setLinkedInUserPublisherForTests(fn);
  return calls;
}

/** Publieur suspendu jusqu'à `settle` : laisse le temps de modifier le post pendant l'appel. */
function gatedPublisher() {
  let started!: () => void;
  let settle!: (result: PublishResult) => void;
  const startedPromise = new Promise<void>((resolve) => (started = resolve));
  setLinkedInUserPublisherForTests(
    () =>
      new Promise<PublishResult>((resolve) => {
        settle = resolve;
        started();
      }),
  );
  return { started: startedPromise, settle: (result: PublishResult) => settle(result) };
}

/** Claire lance une publication au résultat inconnu : la tentative reste à vérifier. */
async function unconfirmedByClaire(calls: string[]): Promise<PublicationAttempt> {
  await approvePost();
  const res = await publish(VALIDATOR);
  expect(res.status).toBe(422);
  expect(calls).toEqual([VALIDATOR]);
  const attempt = (res.body.error.details as { attempt: PublicationAttempt }).attempt;
  expect(attempt).toMatchObject({ status: "verification_requise", byUserId: VALIDATOR });
  return attempt;
}

/* ------------------------------------------------------------------ */
/* F4 — résolution d'une publication incertaine                        */
/* ------------------------------------------------------------------ */

describe("F4 — résolution réservée à l'auteur de la tentative ou à un admin", () => {
  it("un autre validateur non admin : 403 explicite, rien n'est republié ni résolu", async () => {
    const calls = queuedPublisher(MAYBE_PUBLISHED);
    const attempt = await unconfirmedByClaire(calls);

    for (const resolution of ["not_published", "published"]) {
      const res = await publish(OTHER_VALIDATOR, { resolution });
      expect(res.status).toBe(403);
      expect(res.body.error).toEqual({
        code: "resolution_forbidden",
        message:
          "Seul Claire Dubois, qui a lancé cette publication, ou un administrateur peut indiquer si elle figure sur LinkedIn.",
      });
    }
    expect(calls).toEqual([VALIDATOR]);
    expect(await attemptsFor()).toEqual([
      expect.objectContaining({ id: attempt.id, status: "verification_requise" }),
    ]);
  });

  it("l'auteur de la tentative peut la résoudre", async () => {
    const calls = queuedPublisher(MAYBE_PUBLISHED);
    const attempt = await unconfirmedByClaire(calls);
    const res = await publish(VALIDATOR, { resolution: "published" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: attempt.id, status: "succes", byUserId: VALIDATOR });
  });

  it("un admin peut la résoudre ; la republication part de SON compte et lui est attribuée", async () => {
    const calls = queuedPublisher(MAYBE_PUBLISHED);
    await unconfirmedByClaire(calls);
    const res = await publish(ADMIN, { resolution: "not_published" });
    expect(res.status).toBe(201);
    expect(calls).toEqual([VALIDATOR, ADMIN]);
    expect(res.body).toMatchObject({ status: "succes", by: "Sophie Martin", byUserId: ADMIN });
  });

  it("tentative ancienne sans byUserId : résolution réservée aux admins", async () => {
    const calls = queuedPublisher();
    const post = await approvePost();
    await repo.publications.insert({
      id: "pub_ancienne",
      idempotencyKey: idempotencyKey(POST_ID, post.version, "linkedin"),
      articleId: post.articleId,
      linkedinPostId: POST_ID,
      newsletterId: null,
      channel: "linkedin",
      version: post.version,
      status: "verification_requise",
      code: "linkedin_api_error",
      message: MAYBE_MESSAGE,
      attempts: 1,
      remoteId: null,
      mode: "publication",
      at: NOW.toISOString(),
      by: "Claire Dubois",
    });

    const refused = await publish(VALIDATOR, { resolution: "not_published" });
    expect(refused.status).toBe(403);
    expect(refused.body.error).toEqual({
      code: "resolution_forbidden",
      message:
        "L'auteur de cette publication n'est pas connu : seul un administrateur peut indiquer si elle figure sur LinkedIn.",
    });
    expect(calls).toEqual([]);

    const res = await publish(ADMIN, { resolution: "published" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: "pub_ancienne", status: "succes" });
  });

  it("les tentatives bloquées, WordPress et newsletter portent aussi byUserId", async () => {
    const blocked = await publish(VALIDATOR);
    expect(blocked.status).toBe(422);
    expect((blocked.body.error.details as { attempt: PublicationAttempt }).attempt).toMatchObject({
      status: "bloque",
      byUserId: VALIDATOR,
    });
    const again = await publish(ADMIN);
    expect((again.body.error.details as { attempt: PublicationAttempt }).attempt).toMatchObject({
      attempts: 2,
      byUserId: ADMIN,
    });

    const wordpress = await call<PublicationAttempt>("POST", "/articles/art_pasqal/publish", {
      body: { channel: "wordpress" },
      user: VALIDATOR,
    });
    expect(wordpress.status).toBe(201);
    expect(wordpress.body.byUserId).toBe(VALIDATOR);

    const nl = (await call<NewsletterEdition>("GET", "/newsletters/nl_current")).body;
    expect(
      (
        await call("POST", "/newsletters/nl_current/approve", {
          body: { version: nl.version, revision: nl.revision },
          user: VALIDATOR,
        })
      ).status,
    ).toBe(200);
    await call("POST", "/newsletters/nl_current/export", {
      user: VALIDATOR,
      body: { version: nl.version, revision: nl.revision + 1 },
    });
    const exports = await call<PublicationAttempt[]>("GET", "/publications?channel=newsletter");
    expect(exports.body.find((p) => p.newsletterId === "nl_current")).toMatchObject({
      byUserId: VALIDATOR,
    });
  });
});

/* ------------------------------------------------------------------ */
/* F5 — clé LinkedIn illisible                                         */
/* ------------------------------------------------------------------ */

describe("F5 — erreur de lecture de la clé : 503, tentative en échec, jamais d'export", () => {
  it("publication : 503 linkedin_unavailable, tentative echec, post non exporté", async () => {
    vi.mocked(getConnectionKeyForUser).mockRejectedValue(new ConnectionKeyUnavailableError());
    await approvePost();

    const res = await publish(VALIDATOR);
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({
      code: "linkedin_unavailable",
      message: KEY_UNAVAILABLE_MESSAGE,
      details: { attempt: { status: "echec", code: "linkedin_unavailable" } },
    });
    expect(getConnectionKeyForUser).toHaveBeenCalledWith(VALIDATOR, "linkedin");
    const attempts = await attemptsFor();
    expect(attempts).toEqual([
      expect.objectContaining({
        status: "echec",
        code: "linkedin_unavailable",
        message: KEY_UNAVAILABLE_MESSAGE,
        byUserId: VALIDATOR,
      }),
    ]);
    expect(attempts.some((a) => a.mode === "export" || a.status === "succes")).toBe(false);
    expect(deleteConnectionKeyForUser).not.toHaveBeenCalled();
    expect((await getPost()).status).toBe("approuve");
    const journal = await call<AuditEvent[]>("GET", "/audit?entity=publication");
    expect(journal.body).toContainEqual(
      expect.objectContaining({ action: "publication.failed", entityId: attempts[0]!.id }),
    );

    // L'échec n'est pas définitif : une fois la base relue, la publication repart.
    vi.mocked(getConnectionKeyForUser).mockResolvedValue(null);
    const retry = await publish(VALIDATOR);
    expect(retry.status).toBe(201);
    expect(retry.body).toMatchObject({ status: "succes", mode: "export" });
  });

  it("statut : 503 explicite, la clé stockée n'est pas supprimée", async () => {
    vi.mocked(getConnectionKeyForUser).mockRejectedValue(new ConnectionKeyUnavailableError());
    const res = await call<ApiErrorBody>("GET", "/me/linkedin", { user: VALIDATOR });
    expect(res.status).toBe(503);
    expect(res.body.error).toEqual({
      code: "linkedin_unavailable",
      message: KEY_UNAVAILABLE_MESSAGE,
    });
    expect(deleteConnectionKeyForUser).not.toHaveBeenCalled();
  });
});

describe("N3 — clé illisible : déconnexion, reconnexion et suppression restent possibles", () => {
  beforeEach(() => {
    vi.mocked(disconnectAppUser).mockReset().mockResolvedValue();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  const unreadableFor = (userId: string) =>
    vi.mocked(getConnectionKeyForUser).mockImplementation(async (id) => {
      if (id === userId) throw new ConnectionKeyUnavailableError();
      return null;
    });

  it("déconnexion : 200, connexion supprimée sans révocation, journalisée", async () => {
    unreadableFor(VALIDATOR);
    const res = await call<{ ok: boolean }>("POST", "/me/linkedin/disconnect", { user: VALIDATOR });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(disconnectAppUser).not.toHaveBeenCalled();
    expect(vi.mocked(deleteConnectionKeyForUser).mock.calls).toEqual([[VALIDATOR, "linkedin"]]);
    expect(console.error).toHaveBeenCalledWith(
      `[linkedin] connexion de ${VALIDATOR} illisible : suppression sans révocation`,
    );
    const journal = await call<AuditEvent[]>("GET", "/audit?entity=user");
    expect(journal.body).toContainEqual(
      expect.objectContaining({
        action: "linkedin.disconnect",
        entityId: VALIDATOR,
        details: UNREADABLE_REMOVED,
      }),
    );
  });

  it("reconnexion : connexion illisible supprimée, consentement neuf, nouvelle clé enregistrée", async () => {
    unreadableFor(VALIDATOR);
    const state = await connect(VALIDATOR);
    expect(vi.mocked(deleteConnectionKeyForUser).mock.calls).toEqual([[VALIDATOR, "linkedin"]]);
    expect(vi.mocked(authorizeAppUserOAuth).mock.calls[0]![0]).not.toHaveProperty(
      "connectionAPIKey",
    );
    expect((await complete(VALIDATOR, { code: "code-1", state })).status).toBe(200);
    expect(saveConnectionKeyForUser).toHaveBeenCalledWith(
      VALIDATOR,
      "linkedin",
      "lovack_cle_de_test",
    );
  });

  it("suppression de l'utilisateur : 204, connexion et attente effacées, sans révocation", async () => {
    const state = await connect(VALIDATOR);
    unreadableFor(VALIDATOR);
    const res = await call("DELETE", `/users/${VALIDATOR}`, { user: ADMIN });
    expect(res.status).toBe(204);
    expect(await repo.users.get(VALIDATOR)).toBeUndefined();
    expect(disconnectAppUser).not.toHaveBeenCalled();
    expect(vi.mocked(deleteConnectionKeyForUser).mock.calls).toEqual([[VALIDATOR, "linkedin"]]);
    expect(await consumePendingConnect(repo, VALIDATOR, state)).toBe(false);
  });

  it("base réellement en panne : la suppression échoue elle-même en 503, l'utilisateur reste", async () => {
    unreadableFor(VALIDATOR);
    vi.mocked(deleteConnectionKeyForUser).mockRejectedValue(
      new HttpError(503, "linkedin_unavailable", DELETE_UNAVAILABLE_MESSAGE),
    );
    for (const [method, path, user] of [
      ["POST", "/me/linkedin/disconnect", VALIDATOR],
      ["POST", "/me/linkedin/connect", VALIDATOR],
      ["DELETE", `/users/${VALIDATOR}`, ADMIN],
    ] as const) {
      const res = await call<ApiErrorBody>(method, path, { user });
      expect(res.status, `${method} ${path}`).toBe(503);
      expect(res.body.error).toEqual({
        code: "linkedin_unavailable",
        message: DELETE_UNAVAILABLE_MESSAGE,
      });
    }
    expect(await repo.users.get(VALIDATOR)).toBeDefined();
    expect(authorizeAppUserOAuth).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* F6 — mise à jour perdue en fin de publication                       */
/* ------------------------------------------------------------------ */

describe("F6 — le post relu sous verrou n'est pas écrasé en fin de publication", () => {
  it.each([
    ["publication", { kind: "published", remoteId: "urn:li:share:7301" } as PublishResult],
    ["export", { kind: "not_connected" } as PublishResult],
  ])(
    "%s : une nouvelle version enregistrée pendant l'appel est conservée telle quelle",
    async (_label, result) => {
      const gate = gatedPublisher();
      const approved = await approvePost();

      const pending = publish(VALIDATOR);
      await gate.started;
      const variants = approved.variants.map((v) =>
        v.id === approved.selectedVariantId ? { ...v, text: "Texte corrigé pendant l'appel." } : v,
      );
      const edited = await call<LinkedInPost>("PATCH", `/linkedin/${POST_ID}`, {
        body: { variants },
        user: EDITOR,
      });
      expect(edited.status).toBe(200);
      expect(edited.body).toMatchObject({ version: approved.version + 1, status: "a_valider" });

      gate.settle(result);
      const res = await pending;
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: "succes", version: approved.version });

      const after = await getPost();
      expect(after).toMatchObject({
        version: approved.version + 1,
        status: "a_valider",
        updatedAt: edited.body.updatedAt,
      });
      expect(after.variants).toEqual(variants);
      expect(after.approval).toMatchObject({ valid: false });
    },
  );

  it("même version : seul le statut change, une modification concurrente est conservée", async () => {
    const gate = gatedPublisher();
    await approvePost();

    const pending = publish(VALIDATOR);
    await gate.started;
    await repo.linkedin.update({ ...(await getPost()), signalId: "sig_fusionne" });

    gate.settle({ kind: "published", remoteId: "urn:li:share:7302" });
    expect((await pending).status).toBe(201);
    expect(await getPost()).toMatchObject({ status: "publie", signalId: "sig_fusionne" });
  });
});
