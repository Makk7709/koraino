import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ApiErrorBody,
  AuditEvent,
  AuthConfig,
  NewsletterEdition,
  User,
} from "@/lib/api/types";
import { handleApiRequest } from "@/server/router";
import type { Repository } from "@/server/store/repository";
import {
  bearer,
  call,
  NOW,
  resetAuthSeams,
  setup,
  teardown,
  useFakeSupabaseAuth,
  USERS,
  type FakeSupabaseAuth,
} from "./helpers";

let repo: Repository;

beforeEach(() => {
  repo = setup();
});
afterEach(() => {
  teardown();
  resetAuthSeams();
  vi.unstubAllEnvs();
});

const nowSec = Math.floor(NOW.getTime() / 1000);

/** Rattache un compte Supabase factice à un utilisateur du seed. */
async function linkAccount(fake: FakeSupabaseAuth, userId: string, activated = true) {
  const user = (await repo.users.get(userId))!;
  const account = fake.addAccount(user.email);
  await repo.users.update({
    ...user,
    authUserId: account.id,
    activatedAt: activated ? NOW.toISOString() : null,
  });
  return { account, token: fake.tokenFor(account.id) };
}

function expectUnauthenticated(res: { status: number; body: unknown }, label: string) {
  expect(res.status, label).toBe(401);
  const body = res.body as ApiErrorBody;
  expect(body.error.code, label).toBe("unauthenticated");
  expect(body.error.message, label).toBe("Session absente ou expirée : reconnectez-vous.");
}

describe("mode démonstration (comportement inchangé)", () => {
  it("garde le profil par défaut, le cookie kora_uid et le changement de profil", async () => {
    const config = await call<AuthConfig>("GET", "/auth/config");
    expect(config.body).toEqual({ mode: "demo" });

    const me = await call<User>("GET", "/me");
    expect(me.body).toMatchObject({ id: "u_sophie", hasAccount: false });
    expect(me.text).not.toContain("authUserId");

    const session = await call<User>("POST", "/auth/session");
    expect(session.status).toBe(200);
    expect(session.body.id).toBe("u_sophie");
    expect(session.headers.get("set-cookie")).toBeNull();

    expect((await call<User>("GET", "/me", { user: USERS.lecteur })).body.id).toBe("u_marc");
    const switched = await call<User>("POST", "/me", { body: { userId: USERS.redacteur } });
    expect(switched.status).toBe(200);
    expect(switched.headers.get("set-cookie")).toContain("kora_uid=u_lucas");
  });
});

describe("mode supabase : session obligatoire", () => {
  let fake: FakeSupabaseAuth;
  beforeEach(() => {
    fake = useFakeSupabaseAuth();
  });

  it("annonce le mode sans exiger de session", async () => {
    const config = await call<AuthConfig>("GET", "/auth/config");
    expect(config.status).toBe(200);
    expect(config.body).toEqual({ mode: "supabase" });
  });

  it("répond 401 sans jeton, en lecture comme en écriture", async () => {
    for (const [method, path, body] of [
      ["GET", "/me", undefined],
      ["GET", "/users", undefined],
      ["GET", "/dashboard", undefined],
      ["GET", "/export/companies?format=json", undefined],
      ["POST", "/companies", { name: "Intrus", domain: "intrus.fr", sector: "Test" }],
      ["DELETE", "/companies/co_pasqal", undefined],
    ] as const) {
      expectUnauthenticated(await call(method, path, { body }), `${method} ${path}`);
    }
    expect(await repo.companies.get("co_pasqal")).toBeDefined();
  });

  it("répond 401 pour un jeton invalide ou un en-tête mal formé", async () => {
    for (const authorization of ["Bearer inconnu", "Bearer ", "Basic dXNlcjpwYXNz", "jeton"]) {
      expectUnauthenticated(
        await call("GET", "/me", { headers: { authorization } }),
        authorization,
      );
    }
  });

  it("ignore le cookie kora_uid : on ne peut plus se faire passer pour un autre", async () => {
    expectUnauthenticated(await call("GET", "/me", { user: USERS.admin }), "GET /me");
    expectUnauthenticated(
      await call("POST", "/me", { user: USERS.admin, body: { userId: USERS.admin } }),
      "POST /me",
    );
    expectUnauthenticated(
      await call("PATCH", "/signals/sig_pasqal", { user: USERS.admin, body: { status: "rejete" } }),
      "PATCH /signals",
    );
    const { token } = await linkAccount(fake, USERS.redacteur);
    const lucas = await call<User>("GET", "/me", { user: USERS.admin, headers: bearer(token) });
    expect(lucas.status).toBe(200);
    expect(lucas.body.id).toBe(USERS.redacteur);
  });

  it("répond 403 à un compte Supabase valide mais non autorisé sur KORA", async () => {
    const intruder = fake.addAccount("intrus@example.com");
    const res = await call<ApiErrorBody>("GET", "/me", {
      headers: bearer(fake.tokenFor(intruder.id)),
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toEqual({
      code: "account_not_authorized",
      message:
        "Votre compte n'est pas autorisé sur KORA. Demandez à un administrateur de vous inviter.",
    });
  });

  it("accepte le jeton Bearer partout, le cookie __Host-kora_session sur les seuls téléchargements", async () => {
    const { account, token } = await linkAccount(fake, USERS.admin);
    const viaBearer = await call<User>("GET", "/me", { headers: bearer(token) });
    expect(viaBearer.status).toBe(200);
    expect(viaBearer.body).toMatchObject({ id: "u_sophie", hasAccount: true });
    expect(viaBearer.text).not.toContain("authUserId");
    expect(viaBearer.text).not.toContain(account.id);

    const cookie = { cookie: `__Host-kora_session=${token}` };
    for (const path of [
      "/export/companies?format=csv",
      "/export/manifest",
      "/linkedin/li_pasqal/export",
      "/newsletters/nl_current/export?format=txt",
    ]) {
      const download = await call("GET", path, { headers: cookie });
      expect(download.status, path).toBe(200);
      expect(download.headers.get("content-disposition"), path).toContain("attachment");
    }
    for (const path of ["/me", "/users", "/dashboard", "/newsletters/nl_current", "/audit"]) {
      expectUnauthenticated(await call("GET", path, { headers: cookie }), `GET ${path} par cookie`);
    }
    expectUnauthenticated(
      await call("POST", "/notifications/read", { headers: cookie }),
      "écriture par cookie",
    );
    expect((await call("POST", "/notifications/read", { headers: bearer(token) })).status).toBe(
      204,
    );
  });

  it("refuse le cookie sur un téléchargement intersite, ou sous l'ancien nom", async () => {
    const { token } = await linkAccount(fake, USERS.admin);
    const path = "/export/companies?format=csv";
    const withCookie = (site?: string, name = "__Host-kora_session") => ({
      headers: { cookie: `${name}=${token}`, ...(site ? { "sec-fetch-site": site } : {}) },
    });
    for (const site of ["cross-site", "same-site"]) {
      expectUnauthenticated(await call("GET", path, withCookie(site)), site);
    }
    for (const site of ["same-origin", "none", undefined]) {
      expect((await call("GET", path, withCookie(site))).status, String(site)).toBe(200);
    }
    expectUnauthenticated(
      await call("GET", path, withCookie(undefined, "kora_session")),
      "ancien nom",
    );
    const head = await handleApiRequest(
      new Request(`http://localhost/api${path}`, { method: "HEAD", ...withCookie("same-origin") }),
    );
    expect(head.status).toBe(200);
  });

  it("export de newsletter : téléchargement par lien sans effet, consignation par requête authentifiée", async () => {
    const { token } = await linkAccount(fake, USERS.admin);
    const edition = await call<NewsletterEdition>("GET", "/newsletters/nl_current", {
      headers: bearer(token),
    });
    const approved = await call<NewsletterEdition>("POST", "/newsletters/nl_current/approve", {
      headers: bearer(token),
      body: { version: edition.body.version },
    });
    expect(approved.body.status).toBe("approuvee");
    const publications = (await repo.publications.list()).length;
    const exportPath = "/newsletters/nl_current/export?format=html";
    const cookie = `__Host-kora_session=${token}`;

    expectUnauthenticated(
      await call("GET", exportPath, { headers: { cookie, "sec-fetch-site": "cross-site" } }),
      "lien piégé",
    );
    expect((await repo.newsletters.get("nl_current"))?.status).toBe("approuvee");
    expect(await repo.publications.list()).toHaveLength(publications);

    const viaLink = await call("GET", exportPath, {
      headers: { cookie, "sec-fetch-site": "same-origin" },
    });
    expect(viaLink.status).toBe(200);
    expect((await repo.newsletters.get("nl_current"))?.status).toBe("approuvee");
    expect(await repo.publications.list()).toHaveLength(publications);

    expectUnauthenticated(
      await call("POST", "/newsletters/nl_current/export", {
        headers: { cookie, "sec-fetch-site": "same-origin" },
      }),
      "consignation par cookie",
    );
    const recorded = await call<NewsletterEdition>("POST", "/newsletters/nl_current/export", {
      headers: bearer(token),
    });
    expect(recorded.body.status).toBe("exportee");
    expect(await repo.publications.list()).toHaveLength(publications + 1);
  });

  it("réserve POST /me à la démonstration (403 demo_only)", async () => {
    const { token } = await linkAccount(fake, USERS.lecteur);
    const res = await call<ApiErrorBody>("POST", "/me", {
      headers: bearer(token),
      body: { userId: USERS.admin },
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("demo_only");
    expect((await call<User>("GET", "/me", { headers: bearer(token) })).body.id).toBe("u_marc");
  });

  it("ferme les connecteurs LinkedIn et la publication aux visiteurs anonymes", async () => {
    const publications = (await repo.publications.list()).length;
    for (const [method, path, body] of [
      ["GET", "/me/linkedin", undefined],
      ["POST", "/me/linkedin/connect", undefined],
      ["POST", "/me/linkedin/complete", { code: "code-oauth" }],
      ["POST", "/me/linkedin/disconnect", undefined],
      ["POST", "/linkedin/li_pasqal/publish", undefined],
    ] as const) {
      expectUnauthenticated(await call(method, path, { body, user: USERS.admin }), path);
    }
    expect(await repo.publications.list()).toHaveLength(publications);
  });

  it("marque le compte activé à sa première connexion", async () => {
    const admin = await linkAccount(fake, USERS.admin);
    const invited = await linkAccount(fake, USERS.validateur, false);
    const hasAccount = async () =>
      (await call<User[]>("GET", "/users", { headers: bearer(admin.token) })).body.find(
        (u) => u.id === USERS.validateur,
      )?.hasAccount;
    expect(await hasAccount()).toBe(false);
    expect((await call("GET", "/me", { headers: bearer(invited.token) })).status).toBe(200);
    expect(await hasAccount()).toBe(true);
    expect((await repo.users.get(USERS.validateur))?.activatedAt).toBe(NOW.toISOString());
  });
});

describe("POST /auth/session et /auth/logout", () => {
  let fake: FakeSupabaseAuth;
  beforeEach(() => {
    fake = useFakeSupabaseAuth();
  });

  it("pose un cookie __Host-, HttpOnly; Secure; SameSite=Strict pour la durée restante du jeton", async () => {
    const { account } = await linkAccount(fake, USERS.admin);
    const token = fake.tokenFor(account.id, nowSec + 1800);
    const res = await call<User>("POST", "/auth/session", { headers: bearer(token) });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: "u_sophie", hasAccount: true });
    expect(res.text).not.toContain("authUserId");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie.startsWith(`__Host-kora_session=${encodeURIComponent(token)};`)).toBe(true);
    for (const attr of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/", "Max-Age=1800"]) {
      expect(cookie, attr).toContain(attr);
    }
    expect(cookie).not.toMatch(/Domain=|SameSite=Lax/i);

    const long = fake.tokenFor(account.id, nowSec + 7200);
    const capped = await call("POST", "/auth/session", { headers: bearer(long) });
    expect(capped.headers.get("set-cookie")).toContain("Max-Age=3600");
  });

  it("exige un Bearer valide et un compte autorisé", async () => {
    const { token } = await linkAccount(fake, USERS.admin);
    expectUnauthenticated(await call("POST", "/auth/session"), "sans jeton");
    expectUnauthenticated(
      await call("POST", "/auth/session", {
        headers: { cookie: `__Host-kora_session=${token}` },
      }),
      "cookie seul",
    );
    expectUnauthenticated(
      await call("POST", "/auth/session", { headers: bearer("faux") }),
      "jeton invalide",
    );
    const stranger = fake.addAccount("inconnu@example.com");
    const denied = await call<ApiErrorBody>("POST", "/auth/session", {
      headers: bearer(fake.tokenFor(stranger.id)),
    });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("account_not_authorized");
    expect(denied.headers.get("set-cookie")).toBeNull();
    const noCsrf = await call<ApiErrorBody>("POST", "/auth/session", {
      headers: bearer(token),
      csrf: false,
    });
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.error.code).toBe("csrf_header_missing");
  });

  it("efface le cookie à la déconnexion", async () => {
    const res = await call("POST", "/auth/logout");
    expect(res.status).toBe(204);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^__Host-kora_session=;/);
    for (const attr of ["Max-Age=0", "HttpOnly", "Secure", "SameSite=Strict", "Path=/"]) {
      expect(cookie, attr).toContain(attr);
    }
    expect((await call("POST", "/auth/logout", { csrf: false })).status).toBe(403);
  });
});

describe("amorçage par KORA_ADMIN_EMAILS", () => {
  let fake: FakeSupabaseAuth;
  beforeEach(() => {
    fake = useFakeSupabaseAuth();
  });

  it("crée un seul administrateur pour une adresse listée et confirmée", async () => {
    vi.stubEnv("KORA_ADMIN_EMAILS", " autre@example.com , Direction@Example.com ");
    const account = fake.addAccount("direction@example.com");
    const token = fake.tokenFor(account.id);
    const countBefore = (await repo.users.list()).length;

    const [a, b] = await Promise.all([
      call<User>("GET", "/me", { headers: bearer(token) }),
      call<User>("GET", "/me", { headers: bearer(token) }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.id).toBe(b.body.id);
    expect(a.body).toMatchObject({
      email: "direction@example.com",
      name: "Direction",
      roles: ["admin"],
      hasAccount: true,
    });
    expect(a.text).not.toContain(account.id);
    expect((await repo.users.list()).length).toBe(countBefore + 1);
    const again = await call<User>("GET", "/me", { headers: bearer(token) });
    expect(again.body.id).toBe(a.body.id);
    const audits = await call<AuditEvent[]>("GET", "/audit?entity=user", {
      headers: bearer(token),
    });
    expect(audits.body.filter((e) => e.action === "user.bootstrap")).toHaveLength(1);
  });

  it("rattache l'utilisateur KORA existant de même adresse et lui donne le rôle admin", async () => {
    vi.stubEnv("KORA_ADMIN_EMAILS", "marc.lefevre@inovallee.com");
    const account = fake.addAccount("Marc.Lefevre@inovallee.com");
    const me = await call<User>("GET", "/me", { headers: bearer(fake.tokenFor(account.id)) });
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(USERS.lecteur);
    expect(me.body.roles).toEqual(["admin", "lecteur"]);
    expect((await repo.users.get(USERS.lecteur))?.authUserId).toBe(account.id);
  });

  it("refuse l'amorçage tant qu'un administrateur actif existe, l'autorise quand il n'y en a plus", async () => {
    vi.stubEnv("KORA_ADMIN_EMAILS", "direction@example.com");
    await linkAccount(fake, USERS.admin);
    const account = fake.addAccount("direction@example.com");
    const token = fake.tokenFor(account.id);
    const countBefore = (await repo.users.list()).length;

    const refused = await call<ApiErrorBody>("GET", "/me", { headers: bearer(token) });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe("account_not_authorized");
    expect((await repo.users.list()).length).toBe(countBefore);

    const sophie = (await repo.users.get(USERS.admin))!;
    await repo.users.update({ ...sophie, roles: ["redacteur"] });
    const recovered = await call<User>("GET", "/me", { headers: bearer(token) });
    expect(recovered.status).toBe(200);
    expect(recovered.body).toMatchObject({ email: "direction@example.com", roles: ["admin"] });
  });

  it("un administrateur listé puis supprimé ne revient pas avec son jeton encore valide", async () => {
    vi.stubEnv("KORA_ADMIN_EMAILS", "ex.salarie@inovallee.com");
    const ex = fake.addAccount("ex.salarie@inovallee.com");
    const exToken = fake.tokenFor(ex.id);
    const first = await call<User>("GET", "/me", { headers: bearer(exToken) });
    expect(first.body.roles).toContain("admin");

    const { token: sophieToken } = await linkAccount(fake, USERS.admin);
    expect(
      (await call("DELETE", `/users/${first.body.id}`, { headers: bearer(sophieToken) })).status,
    ).toBe(204);
    const again = await call<ApiErrorBody>("GET", "/me", { headers: bearer(exToken) });
    expect(again.status).toBe(403);
    expect(again.body.error.code).toBe("account_not_authorized");
    expect(await repo.users.get(first.body.id)).toBeUndefined();
  });

  it("refuse une adresse listée tant qu'elle n'est pas confirmée (403)", async () => {
    vi.stubEnv("KORA_ADMIN_EMAILS", "nouveau@example.com");
    const account = fake.addAccount("nouveau@example.com", { confirmed: false });
    const countBefore = (await repo.users.list()).length;
    const res = await call<ApiErrorBody>("GET", "/me", {
      headers: bearer(fake.tokenFor(account.id)),
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("account_not_authorized");
    expect((await repo.users.list()).length).toBe(countBefore);
  });
});
