import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ApiErrorBody,
  AuditEvent,
  CreatedUser,
  InvitationResult,
  User,
} from "@/lib/api/types";
import { disconnectAppUser } from "@/integrations/lovable/appUserConnector";
import {
  deleteConnectionKeyForUser,
  getConnectionKeyForUser,
} from "@/server/appUserConnections.server";
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

vi.mock("@/server/appUserConnections.server", () => ({
  getConnectionKeyForUser: vi.fn(async () => null),
  saveConnectionKeyForUser: vi.fn(async () => {}),
  deleteConnectionKeyForUser: vi.fn(async () => {}),
}));
vi.mock("@/integrations/lovable/appUserConnector", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/integrations/lovable/appUserConnector")>()),
  disconnectAppUser: vi.fn(async () => {}),
}));

let repo: Repository;

beforeEach(() => {
  repo = setup();
  vi.clearAllMocks();
});
afterEach(() => {
  teardown();
  resetAuthSeams();
});

const NINA = { name: "Nina Roux", email: "Nina.Roux@Inovallee.com", team: "Communication" };

async function audits(opts: CallOptions = {}) {
  return (await call<AuditEvent[]>("GET", "/audit?entity=user", opts)).body;
}

describe("gestion des utilisateurs (démonstration)", () => {
  it("un administrateur ajoute un utilisateur, sans invitation", async () => {
    const res = await call<CreatedUser>("POST", "/users", {
      body: { ...NINA, roles: ["redacteur", "redacteur"] },
    });
    expect(res.status).toBe(201);
    expect(res.body.invitation).toBe("not_applicable");
    expect(res.body.user).toMatchObject({
      name: "Nina Roux",
      email: "nina.roux@inovallee.com",
      team: "Communication",
      roles: ["redacteur"],
      avatarUrl: null,
      hasAccount: false,
    });
    const list = await call<User[]>("GET", "/users");
    expect(list.body.map((u) => u.id)).toContain(res.body.user.id);
    expect(list.text).not.toMatch(/authUserId|activatedAt/);
    expect((await audits()).some((e) => e.action === "user.create")).toBe(true);
    const switched = await call<User>("POST", "/me", { body: { userId: res.body.user.id } });
    expect(switched.body.roles).toEqual(["redacteur"]);
  });

  it("refuse une adresse déjà utilisée, quelle que soit la casse (409)", async () => {
    const res = await call<ApiErrorBody>("POST", "/users", {
      body: { name: "Doublon", email: " SOPHIE.Martin@inovallee.com ", roles: ["lecteur"] },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("email_taken");
  });

  it("valide le corps de la requête (400)", async () => {
    for (const body of [
      { ...NINA, roles: [] },
      { ...NINA, roles: ["superadmin"] },
      { ...NINA, email: "pas-une-adresse", roles: ["lecteur"] },
      { email: "x@example.com", roles: ["lecteur"] },
    ]) {
      const res = await call<ApiErrorBody>("POST", "/users", { body });
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe("validation_error");
    }
  });

  it("réserve la gestion des utilisateurs aux administrateurs (403)", async () => {
    for (const [method, path, body] of [
      ["POST", "/users", { ...NINA, roles: ["lecteur"] }],
      ["PATCH", `/users/${USERS.lecteur}`, { roles: ["admin"] }],
      ["DELETE", `/users/${USERS.lecteur}`, undefined],
      ["POST", `/users/${USERS.lecteur}/invite`, undefined],
    ] as const) {
      const res = await call<ApiErrorBody>(method, path, { body, user: USERS.redacteur });
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.body.error.code).toBe("forbidden");
      expect(res.body.error.message).toMatch(/administrateurs/);
    }
    expect((await repo.users.get(USERS.lecteur))?.roles).toEqual(["lecteur"]);
  });

  it("modifie le nom, l'équipe et les rôles", async () => {
    const res = await call<User>("PATCH", `/users/${USERS.lecteur}`, {
      body: { name: "Marc L.", team: "Direction", roles: ["validateur", "lecteur"] },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: USERS.lecteur,
      name: "Marc L.",
      team: "Direction",
      roles: ["validateur", "lecteur"],
    });
    expect(res.text).not.toContain("authUserId");
    const update = (await audits()).find((e) => e.action === "user.update");
    expect(update?.details).toContain("Validateur, Lecteur");
    expect((await call("PATCH", "/users/u_inconnu", { body: { name: "X" } })).status).toBe(404);
  });

  it("protège le dernier administrateur et interdit de se rétrograder ou de se supprimer", async () => {
    const lastAdmin = await call<ApiErrorBody>("PATCH", `/users/${USERS.admin}`, {
      body: { roles: ["redacteur"] },
    });
    expect(lastAdmin.status).toBe(422);
    expect(lastAdmin.body.error.code).toBe("last_admin");

    const promoted = await call<User>("PATCH", `/users/${USERS.redacteur}`, {
      body: { roles: ["admin", "redacteur"] },
    });
    expect(promoted.status).toBe(200);

    const selfDemotion = await call<ApiErrorBody>("PATCH", `/users/${USERS.admin}`, {
      body: { roles: ["redacteur"] },
    });
    expect(selfDemotion.status).toBe(422);
    expect(selfDemotion.body.error.code).toBe("self_demotion");

    const selfDelete = await call<ApiErrorBody>("DELETE", `/users/${USERS.admin}`);
    expect(selfDelete.status).toBe(422);
    expect(selfDelete.body.error.code).toBe("self_delete");

    const demotedByPeer = await call<User>("PATCH", `/users/${USERS.admin}`, {
      body: { roles: ["redacteur", "validateur"] },
      user: USERS.redacteur,
    });
    expect(demotedByPeer.status).toBe(200);
    const lucasAlone = await call<ApiErrorBody>("DELETE", `/users/${USERS.redacteur}`, {
      user: USERS.redacteur,
    });
    expect(lucasAlone.status).toBe(422);
    expect(lucasAlone.body.error.code).toBe("last_admin");
    expect((await repo.users.list()).filter((u) => u.roles.includes("admin"))).toHaveLength(1);
  });

  it("supprime un utilisateur, révoque et efface sa connexion LinkedIn", async () => {
    vi.mocked(getConnectionKeyForUser).mockResolvedValueOnce("lovack_test");
    vi.mocked(disconnectAppUser).mockRejectedValueOnce(new Error("passerelle indisponible"));
    const res = await call("DELETE", `/users/${USERS.lecteur}`);
    expect(res.status).toBe(204);
    expect(getConnectionKeyForUser).toHaveBeenCalledWith(USERS.lecteur, "linkedin");
    expect(disconnectAppUser).toHaveBeenCalledWith(
      expect.objectContaining({ connectionAPIKey: "lovack_test", connectorId: "linkedin" }),
    );
    expect(deleteConnectionKeyForUser).toHaveBeenCalledWith(USERS.lecteur, "linkedin");
    expect(await repo.users.get(USERS.lecteur)).toBeUndefined();
    expect((await audits()).some((e) => e.action === "user.delete")).toBe(true);
    expect((await call("DELETE", `/users/${USERS.lecteur}`)).status).toBe(404);
  });

  it("renvoyer une invitation est sans objet en démonstration", async () => {
    const res = await call<InvitationResult>("POST", `/users/${USERS.lecteur}/invite`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ invitation: "not_applicable" });
  });
});

describe("gestion des utilisateurs (mode supabase)", () => {
  let fake: FakeSupabaseAuth;
  let adminToken: string;
  let adminAccountId: string;

  beforeEach(async () => {
    fake = useFakeSupabaseAuth();
    const sophie = (await repo.users.get(USERS.admin))!;
    const account = fake.addAccount(sophie.email);
    await repo.users.update({ ...sophie, authUserId: account.id, activatedAt: NOW.toISOString() });
    adminAccountId = account.id;
    adminToken = fake.tokenFor(account.id);
  });

  const asAdmin = (opts: CallOptions = {}): CallOptions => ({
    ...opts,
    headers: { ...bearer(adminToken), ...opts.headers },
  });

  it("invite par e-mail, rattache le compte, puis le nouvel utilisateur peut se connecter", async () => {
    const res = await call<CreatedUser>(
      "POST",
      "/users",
      asAdmin({ body: { ...NINA, roles: ["redacteur"] } }),
    );
    expect(res.status).toBe(201);
    expect(res.body.invitation).toBe("sent");
    expect(res.body.user.hasAccount).toBe(false);
    expect(fake.invites).toEqual([
      {
        email: "nina.roux@inovallee.com",
        redirectTo: "http://localhost/connexion/nouveau-mot-de-passe",
      },
    ]);
    const stored = (await repo.users.get(res.body.user.id))!;
    const account = fake.accounts.get(stored.authUserId!)!;
    expect(account.email).toBe("nina.roux@inovallee.com");
    expect(res.text).not.toContain(account.id);

    fake.confirm(account.id);
    const me = await call<User>("GET", "/me", { headers: bearer(fake.tokenFor(account.id)) });
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ id: res.body.user.id, roles: ["redacteur"], hasAccount: true });
    const list = await call<User[]>("GET", "/users", asAdmin());
    expect(list.body.find((u) => u.id === res.body.user.id)?.hasAccount).toBe(true);
  });

  it("ignore x-forwarded-host pour le lien d'invitation", async () => {
    await call(
      "POST",
      "/users",
      asAdmin({
        body: { ...NINA, roles: ["lecteur"] },
        headers: { "x-forwarded-host": "attaquant.example" },
      }),
    );
    expect(fake.invites[0]?.redirectTo).toBe("http://localhost/connexion/nouveau-mot-de-passe");
  });

  it("rattache un compte Supabase confirmé issu d'une invitation sans le réinviter", async () => {
    const existing = fake.addAccount("paul.girard@example.com", { invited: true });
    const res = await call<CreatedUser>(
      "POST",
      "/users",
      asAdmin({
        body: { name: "Paul Girard", email: "paul.girard@example.com", roles: ["lecteur"] },
      }),
    );
    expect(res.status).toBe(201);
    expect(res.body.invitation).toBe("existing_account");
    expect(res.body.user.hasAccount).toBe(true);
    expect(fake.invites).toHaveLength(0);
    expect(fake.deleted).toHaveLength(0);
    const me = await call<User>("GET", "/me", { headers: bearer(fake.tokenFor(existing.id)) });
    expect(me.body.id).toBe(res.body.user.id);
  });

  it("signale l'échec de l'invitation sans perdre l'utilisateur, puis la renvoie", async () => {
    fake.failNextInvite({
      message: "Email rate limit exceeded",
      code: "over_email_send_rate_limit",
      status: 429,
    });
    const res = await call<CreatedUser>(
      "POST",
      "/users",
      asAdmin({ body: { ...NINA, roles: ["validateur"] } }),
    );
    expect(res.status).toBe(201);
    expect(res.body.invitation).toBe("failed");
    expect(res.body.message).toMatch(/Limite d'envoi/);
    expect((await repo.users.get(res.body.user.id))?.authUserId).toBeNull();

    const resent = await call<InvitationResult>(
      "POST",
      `/users/${res.body.user.id}/invite`,
      asAdmin(),
    );
    expect(resent.status).toBe(200);
    expect(resent.body).toEqual({ invitation: "sent" });
    expect(fake.invites).toHaveLength(2);
    expect((await audits(asAdmin())).some((e) => e.action === "user.invite")).toBe(true);

    const accountId = (await repo.users.get(res.body.user.id))!.authUserId!;
    fake.confirm(accountId);
    const me = await call<User>("GET", "/me", { headers: bearer(fake.tokenFor(accountId)) });
    expect(me.body.id).toBe(res.body.user.id);
  });

  it("refuse les non-administrateurs (403)", async () => {
    const lucas = (await repo.users.get(USERS.redacteur))!;
    const account = fake.addAccount(lucas.email);
    await repo.users.update({ ...lucas, authUserId: account.id, activatedAt: NOW.toISOString() });
    const res = await call<ApiErrorBody>("POST", "/users", {
      headers: bearer(fake.tokenFor(account.id)),
      body: { ...NINA, roles: ["admin"] },
    });
    expect(res.status).toBe(403);
    expect(fake.invites).toHaveLength(0);
  });

  it("supprimer un utilisateur lui retire immédiatement l'accès", async () => {
    const lucas = (await repo.users.get(USERS.redacteur))!;
    const account = fake.addAccount(lucas.email);
    await repo.users.update({ ...lucas, authUserId: account.id, activatedAt: NOW.toISOString() });
    const token = fake.tokenFor(account.id);
    expect((await call("GET", "/me", { headers: bearer(token) })).status).toBe(200);
    expect((await call("DELETE", `/users/${USERS.redacteur}`, asAdmin())).status).toBe(204);
    const after = await call<ApiErrorBody>("GET", "/me", { headers: bearer(token) });
    expect(after.status).toBe(403);
    expect(after.body.error.code).toBe("account_not_authorized");
  });

  it("ne renvoie jamais authUserId", async () => {
    const created = await call<CreatedUser>(
      "POST",
      "/users",
      asAdmin({ body: { ...NINA, roles: ["lecteur"] } }),
    );
    const id = created.body.user.id;
    const ninaAccount = (await repo.users.get(id))!.authUserId!;
    const responses = [
      created,
      await call("GET", "/me", asAdmin()),
      await call("GET", "/users", asAdmin()),
      await call("POST", "/auth/session", asAdmin()),
      await call("PATCH", `/users/${id}`, asAdmin({ body: { team: "Presse" } })),
      await call("POST", `/users/${id}/invite`, asAdmin()),
      await call("GET", "/audit?entity=user", asAdmin()),
    ];
    for (const res of responses) {
      expect(res.status).toBeLessThan(300);
      expect(res.text).not.toMatch(/authUserId|activatedAt/);
      expect(res.text).not.toContain(adminAccountId);
      expect(res.text).not.toContain(ninaAccount);
    }
  });
});
