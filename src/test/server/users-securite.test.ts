import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiErrorBody, CreatedUser, InvitationResult, User } from "@/lib/api/types";
import { authorizeAppUserOAuth } from "@/integrations/lovable/appUserConnector";
import {
  findAuthAccountByEmail,
  setAuthAdminForTests,
  type AuthAccount,
  type AuthAdminApi,
} from "@/server/auth/admin";
import { setClock } from "@/server/clock";
import { HttpError } from "@/server/http";
import { publicOrigin } from "@/server/publicUrl";
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
  type CallOptions,
  type FakeSupabaseAuth,
} from "./helpers";

vi.mock("@/integrations/lovable/appUserConnector", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/integrations/lovable/appUserConnector")>()),
  authorizeAppUserOAuth: vi.fn(async () => ({
    authorizationUrl: "https://passerelle.invalid/autoriser",
  })),
}));

let repo: Repository;
let fake: FakeSupabaseAuth;

beforeEach(() => {
  repo = setup();
  fake = useFakeSupabaseAuth();
  vi.clearAllMocks();
});
afterEach(() => {
  teardown();
  resetAuthSeams();
  vi.unstubAllEnvs();
});

/** Rattache un compte Supabase confirmé (issu d'une invitation) à un utilisateur du seed. */
async function link(userId: string) {
  const user = (await repo.users.get(userId))!;
  const account = fake.addAccount(user.email, { invited: true });
  await repo.users.update({ ...user, authUserId: account.id, activatedAt: NOW.toISOString() });
  return fake.tokenFor(account.id);
}

const RECRUE = {
  name: "Nouvelle Recrue",
  email: "nouvelle.recrue@inovallee.com",
  roles: ["validateur"],
};
const NOT_INVITED =
  "Un compte existe déjà pour cette adresse sans être passé par une invitation KORA : vérifiez-le dans la console Lovable Cloud (Users) puis réinvitez.";

describe("E1 — invitation : jamais de rattachement à un compte créé par un tiers", () => {
  let admin: CallOptions;
  beforeEach(async () => {
    admin = { headers: bearer(await link(USERS.admin)) };
  });

  it("supprime le compte non confirmé pré-créé par un tiers puis invite un compte neuf", async () => {
    const squatter = fake.addAccount(RECRUE.email, { confirmed: false });
    const squatterToken = fake.tokenFor(squatter.id);
    const res = await call<CreatedUser>("POST", "/users", { ...admin, body: RECRUE });
    expect(res.status).toBe(201);
    expect(res.body.invitation).toBe("sent");
    expect(fake.deleted).toEqual([squatter.id]);
    expect(fake.accounts.has(squatter.id)).toBe(false);
    const stored = (await repo.users.get(res.body.user.id))!;
    expect(stored.authUserId).toEqual(expect.any(String));
    expect(stored.authUserId).not.toBe(squatter.id);

    // La recrue accepte l'invitation : seul le compte neuf ouvre KORA.
    fake.confirm(stored.authUserId!);
    expect((await call("GET", "/me", { headers: bearer(squatterToken) })).status).toBe(401);
    const me = await call<User>("GET", "/me", {
      headers: bearer(fake.tokenFor(stored.authUserId!)),
    });
    expect(me.body).toMatchObject({ id: res.body.user.id, roles: ["validateur"] });
  });

  it("refuse un compte confirmé sans invited_at (inscription publique), sans le rattacher", async () => {
    const outsider = fake.addAccount(RECRUE.email);
    const res = await call<CreatedUser>("POST", "/users", { ...admin, body: RECRUE });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ invitation: "failed", message: NOT_INVITED });
    expect(res.body.user.hasAccount).toBe(false);
    expect((await repo.users.get(res.body.user.id))?.authUserId).toBeNull();
    expect(fake.invites).toHaveLength(0);
    expect(fake.deleted).toHaveLength(0);

    const denied = await call<ApiErrorBody>("GET", "/me", {
      headers: bearer(fake.tokenFor(outsider.id)),
    });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("account_not_authorized");

    const resent = await call<InvitationResult>("POST", `/users/${res.body.user.id}/invite`, admin);
    expect(resent.body).toEqual({ invitation: "failed", message: NOT_INVITED });
    expect((await repo.users.get(res.body.user.id))?.authUserId).toBeNull();
  });

  it("compte confirmé apparu entre la recherche et l'invitation : échec, sans rattachement", async () => {
    fake.failNextInvite({
      message: "A user with this email address has already been registered",
      code: "email_exists",
      status: 422,
    });
    const res = await call<CreatedUser>("POST", "/users", { ...admin, body: RECRUE });
    expect(res.body).toMatchObject({ invitation: "failed", message: NOT_INVITED });
    expect((await repo.users.get(res.body.user.id))?.authUserId).toBeNull();
  });

  it("renvoyer une invitation en attente remplace le compte non confirmé", async () => {
    const created = await call<CreatedUser>("POST", "/users", { ...admin, body: RECRUE });
    const first = (await repo.users.get(created.body.user.id))!.authUserId!;
    const resent = await call<InvitationResult>(
      "POST",
      `/users/${created.body.user.id}/invite`,
      admin,
    );
    expect(resent.body).toEqual({ invitation: "sent" });
    const second = (await repo.users.get(created.body.user.id))!.authUserId!;
    expect(fake.deleted).toEqual([first]);
    expect(second).not.toBe(first);
    expect(fake.accounts.has(second)).toBe(true);
  });
});

describe("E1 — recherche paginée d'un compte par e-mail", () => {
  const accounts = (n: number, offset = 0): AuthAccount[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `id-${offset + i}`,
      email: `user${offset + i}@example.com`,
    }));

  it("parcourt toutes les pages, même quand le serveur en réduit la taille", async () => {
    const all = accounts(1200);
    const listUsers = vi.fn<AuthAdminApi["listUsers"]>(async (params) => {
      const start = ((params?.page ?? 1) - 1) * 500;
      return { data: { users: all.slice(start, start + 500) }, error: null };
    });
    setAuthAdminForTests({ ...fake.admin, listUsers });
    await expect(findAuthAccountByEmail("USER1100@example.com")).resolves.toMatchObject({
      id: "id-1100",
    });
    await expect(findAuthAccountByEmail("absent@example.com")).resolves.toBeNull();
    expect(listUsers).toHaveBeenCalledTimes(3 + 4);
  });

  it("une recherche tronquée répond 503 au lieu de conclure « aucun compte »", async () => {
    const listUsers = vi.fn<AuthAdminApi["listUsers"]>(async (params) => ({
      data: { users: accounts(1000, ((params?.page ?? 1) - 1) * 1000), total: 50_000 },
      error: null,
    }));
    setAuthAdminForTests({ ...fake.admin, listUsers });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = await findAuthAccountByEmail("absent@example.com").catch((e: unknown) => e);
    errors.mockRestore();
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(503);
  });
});

describe("M3 — contrôle « dernier administrateur » sous verrou", () => {
  async function twoActiveAdmins() {
    for (const id of [USERS.admin, USERS.redacteur]) {
      const user = (await repo.users.get(id))!;
      await repo.users.update({ ...user, roles: ["admin"] });
    }
    return {
      sophie: bearer(await link(USERS.admin)),
      lucas: bearer(await link(USERS.redacteur)),
    };
  }
  const activeAdmins = async () =>
    (await repo.users.list()).filter(
      (u) => u.roles.includes("admin") && u.authUserId && u.activatedAt,
    );

  it("deux rétrogradations croisées simultanées : un seul succès, un administrateur reste", async () => {
    const { sophie, lucas } = await twoActiveAdmins();
    const results = await Promise.all([
      call<ApiErrorBody>("PATCH", `/users/${USERS.redacteur}`, {
        headers: sophie,
        body: { roles: ["lecteur"] },
      }),
      call<ApiErrorBody>("PATCH", `/users/${USERS.admin}`, {
        headers: lucas,
        body: { roles: ["lecteur"] },
      }),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect([403, 409, 422]).toContain(results.find((r) => r.status !== 200)?.status);
    expect(await activeAdmins()).toHaveLength(1);
  });

  it("deux suppressions croisées simultanées : un seul succès, un administrateur reste", async () => {
    const { sophie, lucas } = await twoActiveAdmins();
    const results = await Promise.all([
      call("DELETE", `/users/${USERS.redacteur}`, { headers: sophie }),
      call("DELETE", `/users/${USERS.admin}`, { headers: lucas }),
    ]);
    expect(results.filter((r) => r.status === 204)).toHaveLength(1);
    expect(await activeAdmins()).toHaveLength(1);
  });

  it("répond 409 tant que le verrou est détenu, puis le libère après la requête", async () => {
    const { sophie } = await twoActiveAdmins();
    const lock = (await repo.acquireLock("users:admins", 15_000))!;
    const busy = await call<ApiErrorBody>("PATCH", `/users/${USERS.redacteur}`, {
      headers: sophie,
      body: { roles: ["lecteur"] },
    });
    expect(busy.status).toBe(409);
    expect(busy.body.error.code).toBe("users_busy");
    expect((await call("DELETE", `/users/${USERS.redacteur}`, { headers: sophie })).status).toBe(
      409,
    );
    expect((await repo.users.get(USERS.redacteur))?.roles).toEqual(["admin"]);

    await repo.releaseLock("users:admins", lock);
    const done = await call<User>("PATCH", `/users/${USERS.redacteur}`, {
      headers: sophie,
      body: { roles: ["lecteur"] },
    });
    expect(done.status).toBe(200);
    expect(await repo.acquireLock("users:admins", 1_000)).toEqual(expect.any(String));
  });

  it("mode supabase : un administrateur sans compte ne compte pas comme administrateur", async () => {
    // u_sophie (seed) reste administratrice sans compte ; Claire est la seule administratrice active.
    const claire = (await repo.users.get(USERS.validateur))!;
    await repo.users.update({ ...claire, roles: ["admin", "validateur"] });
    const token = bearer(await link(USERS.validateur));
    const self = await call<ApiErrorBody>("PATCH", `/users/${USERS.validateur}`, {
      headers: token,
      body: { roles: ["validateur"] },
    });
    expect(self.status).toBe(422);
    expect(self.body.error.code).toBe("last_admin");
    expect((await call("DELETE", `/users/${USERS.admin}`, { headers: token })).status).toBe(204);
  });
});

describe("N4 — invitation et première connexion n'annulent pas une modification concurrente", () => {
  /** Lucas : administrateur invité (compte non confirmé) ; Sophie et Claire : administratrices actives. */
  async function pendingAdmin() {
    const sophie = bearer(await link(USERS.admin));
    const lucas = (await repo.users.get(USERS.redacteur))!;
    const pending = fake.addAccount(lucas.email, { confirmed: false, invited: true });
    await repo.users.update({
      ...lucas,
      roles: ["admin"],
      authUserId: pending.id,
      activatedAt: null,
    });
    const claire = (await repo.users.get(USERS.validateur))!;
    await repo.users.update({ ...claire, roles: ["admin"] });
    return { sophie, claire: bearer(await link(USERS.validateur)), pendingId: pending.id };
  }

  /** Retient `inviteUserByEmail` jusqu'à `release()`. */
  function gateInvitations() {
    let reached = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const invite = fake.admin.inviteUserByEmail.bind(fake.admin);
    fake.admin.inviteUserByEmail = async (email, options) => {
      reached = true;
      await gate;
      return invite(email, options);
    };
    return { reached: () => reached, release };
  }

  const demote = (headers: Record<string, string>) =>
    call<ApiErrorBody>("PATCH", `/users/${USERS.redacteur}`, {
      headers,
      body: { roles: ["lecteur"] },
    });

  it("renvoi d'invitation en cours : la rétrogradation attend (409), puis s'applique et reste", async () => {
    const { sophie, claire, pendingId } = await pendingAdmin();
    const gate = gateInvitations();
    const resend = call<InvitationResult>("POST", `/users/${USERS.redacteur}/invite`, {
      headers: sophie,
    });
    await vi.waitFor(() => expect(gate.reached()).toBe(true));

    const busy = await demote(claire);
    expect(busy.status).toBe(409);
    expect(busy.body.error.code).toBe("users_busy");
    gate.release();
    expect((await resend).body).toEqual({ invitation: "sent" });

    expect((await demote(claire)).status).toBe(200);
    const lucas = (await repo.users.get(USERS.redacteur))!;
    expect(lucas.roles).toEqual(["lecteur"]);
    expect(lucas.authUserId).toEqual(expect.any(String));
    expect(lucas.authUserId).not.toBe(pendingId);
    expect(lucas.activatedAt).toBeNull();
  });

  it("verrou expiré pendant une invitation lente : seuls authUserId et activatedAt sont écrits", async () => {
    const { sophie, claire, pendingId } = await pendingAdmin();
    const gate = gateInvitations();
    const resend = call<InvitationResult>("POST", `/users/${USERS.redacteur}/invite`, {
      headers: sophie,
    });
    await vi.waitFor(() => expect(gate.reached()).toBe(true));
    setClock(() => new Date(NOW.getTime() + 5 * 60_000));

    expect((await demote(claire)).status).toBe(200);
    gate.release();
    expect((await resend).body).toEqual({ invitation: "sent" });
    const lucas = (await repo.users.get(USERS.redacteur))!;
    expect(lucas.roles).toEqual(["lecteur"]);
    expect(lucas.authUserId).not.toBe(pendingId);
  });

  it("utilisateur supprimé pendant une invitation lente : il ne réapparaît pas, échec explicite", async () => {
    const { sophie, claire } = await pendingAdmin();
    const gate = gateInvitations();
    const resend = call<InvitationResult>("POST", `/users/${USERS.redacteur}/invite`, {
      headers: sophie,
    });
    await vi.waitFor(() => expect(gate.reached()).toBe(true));
    setClock(() => new Date(NOW.getTime() + 5 * 60_000));

    expect((await call("DELETE", `/users/${USERS.redacteur}`, { headers: claire })).status).toBe(
      204,
    );
    gate.release();
    const res = await resend;
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      invitation: "failed",
      message: "Utilisateur supprimé pendant l'invitation.",
    });
    expect(await repo.users.get(USERS.redacteur)).toBeUndefined();
  });

  it("création pendant une autre modification : 409 users_busy, rien n'est créé ni invité", async () => {
    const sophie = bearer(await link(USERS.admin));
    const lock = (await repo.acquireLock("users:admins", 60_000))!;
    const busy = await call<ApiErrorBody>("POST", "/users", { headers: sophie, body: RECRUE });
    expect(busy.status).toBe(409);
    expect(busy.body.error.code).toBe("users_busy");
    expect(fake.invites).toEqual([]);
    expect((await repo.users.list()).some((u) => u.email === RECRUE.email)).toBe(false);

    await repo.releaseLock("users:admins", lock);
    const created = await call<CreatedUser>("POST", "/users", { headers: sophie, body: RECRUE });
    expect(created.status).toBe(201);
    expect(created.body.invitation).toBe("sent");
  });

  /** Fait passer `mutate` juste après la première lecture de la liste (celle de `resolveKoraUser`). */
  function afterFirstList(mutate: () => Promise<void>) {
    const list = repo.users.list.bind(repo.users);
    let done = false;
    repo.users.list = async () => {
      const snapshot = await list();
      if (!done) {
        done = true;
        await mutate();
      }
      return snapshot;
    };
  }

  async function confirmedNotActivated() {
    const lucas = (await repo.users.get(USERS.redacteur))!;
    const account = fake.addAccount(lucas.email, { invited: true });
    await repo.users.update({
      ...lucas,
      roles: ["admin"],
      authUserId: account.id,
      activatedAt: null,
    });
    return bearer(fake.tokenFor(account.id));
  }

  it("première connexion : l'activation n'écrase pas une rétrogradation concurrente", async () => {
    const token = await confirmedNotActivated();
    afterFirstList(async () => {
      const current = (await repo.users.get(USERS.redacteur))!;
      await repo.users.update({ ...current, roles: ["lecteur"] });
    });
    const me = await call<User>("GET", "/me", { headers: token });
    expect(me.status).toBe(200);
    expect(me.body.roles).toEqual(["lecteur"]);
    const lucas = (await repo.users.get(USERS.redacteur))!;
    expect(lucas.roles).toEqual(["lecteur"]);
    expect(lucas.activatedAt).toBe(NOW.toISOString());
  });

  it("première connexion d'un utilisateur supprimé entre-temps : 403, il ne réapparaît pas", async () => {
    const token = await confirmedNotActivated();
    afterFirstList(async () => {
      await repo.users.remove(USERS.redacteur);
    });
    const me = await call<ApiErrorBody>("GET", "/me", { headers: token });
    expect(me.status).toBe(403);
    expect(me.body.error.code).toBe("account_not_authorized");
    expect(await repo.users.get(USERS.redacteur)).toBeUndefined();
  });
});

describe("F1 — origine publique des liens d'invitation et du retour OAuth", () => {
  it("KORA_PUBLIC_URL l'emporte sur l'hôte de la requête et sur x-forwarded-host", async () => {
    vi.stubEnv("KORA_PUBLIC_URL", "https://kora.example.org/");
    const token = await link(USERS.admin);
    const res = await handleApiRequest(
      new Request("https://evil.example/api/users", {
        method: "POST",
        headers: {
          ...bearer(token),
          "x-kora-request": "1",
          "content-type": "application/json",
          "x-forwarded-host": "attaquant.example",
        },
        body: JSON.stringify(RECRUE),
      }),
    );
    expect(res.status).toBe(201);
    expect(fake.invites[0]?.redirectTo).toBe(
      "https://kora.example.org/connexion/nouveau-mot-de-passe",
    );
  });

  it("sans KORA_PUBLIC_URL : origine de la requête, jamais les en-têtes x-forwarded-*", () => {
    const request = new Request("http://localhost:8080/api/users", {
      headers: { "x-forwarded-host": "attaquant.example", "x-forwarded-proto": "https" },
    });
    expect(publicOrigin({ request })).toBe("http://localhost:8080");
  });

  it("une KORA_PUBLIC_URL invalide n'envoie aucune invitation", async () => {
    vi.stubEnv("KORA_PUBLIC_URL", "kora.example.org");
    expect(() => publicOrigin({ request: new Request("https://kora.example.org/") })).toThrow(
      /KORA_PUBLIC_URL/,
    );
    const admin = bearer(await link(USERS.admin));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await call<CreatedUser>("POST", "/users", { headers: admin, body: RECRUE });
    errors.mockRestore();
    expect(res.body.invitation).toBe("failed");
    expect(fake.invites).toHaveLength(0);
  });

  it("le retour OAuth LinkedIn suit la même règle", async () => {
    vi.stubEnv("LINKEDIN_APP_USER_CONNECTOR_CLIENT_API_KEY", "cle-de-test");
    const headers = { ...bearer(await link(USERS.admin)), "x-forwarded-host": "attaquant.example" };
    expect((await call("POST", "/me/linkedin/connect", { headers })).status).toBe(200);
    expect(vi.mocked(authorizeAppUserOAuth)).toHaveBeenLastCalledWith(
      expect.objectContaining({ returnUrl: "http://localhost/api/oauth/linkedin/return" }),
    );
    vi.stubEnv("KORA_PUBLIC_URL", "https://kora.example.org");
    await call("POST", "/me/linkedin/connect", { headers });
    expect(vi.mocked(authorizeAppUserOAuth)).toHaveBeenLastCalledWith(
      expect.objectContaining({ returnUrl: "https://kora.example.org/api/oauth/linkedin/return" }),
    );
  });
});
