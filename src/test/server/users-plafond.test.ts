/**
 * Plafond de comptes de l'abonnement : 5 comptes nominatifs.
 *
 * `POST /api/users` refuse d'en créer un sixième (422 `account_limit`). Le compte est compté dès
 * sa création, invitation en attente comprise. Rien n'est supprimé ni bloqué pour les comptes
 * existants, et l'amorçage du premier administrateur (`KORA_ADMIN_EMAILS`) n'est pas concerné.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiErrorBody, AuditEvent, CreatedUser, User } from "@/lib/api/types";
import { MAX_ACCOUNTS } from "@/lib/auth/limits";
import type { UserRecord } from "@/server/store/records";
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
});
afterEach(() => {
  teardown();
  resetAuthSeams();
  vi.unstubAllEnvs();
});

const person = (n: number) => ({
  name: `Personne ${n}`,
  email: `personne${n}@inovallee.com`,
  roles: ["lecteur"],
});

const create = (n: number, opts: CallOptions = {}) =>
  call<CreatedUser & ApiErrorBody>("POST", "/users", { ...opts, body: person(n) });

const count = async () => (await repo.users.list()).length;

/** Crée des comptes jusqu'au plafond ; le jeu de démonstration en compte moins de cinq. */
async function fill(opts: CallOptions = {}) {
  const before = await count();
  expect(before).toBeLessThan(MAX_ACCOUNTS);
  for (let n = before + 1; n <= MAX_ACCOUNTS; n++) {
    expect((await create(n, opts)).status, `compte ${n}`).toBe(201);
  }
  expect(await count()).toBe(MAX_ACCOUNTS);
}

const record = (n: number): UserRecord => ({
  id: `u_direct_${n}`,
  name: `Direct ${n}`,
  email: `direct${n}@inovallee.com`,
  team: "",
  roles: ["lecteur"],
  avatarUrl: null,
  authUserId: null,
  activatedAt: null,
});

describe("plafond de comptes (démonstration)", () => {
  it("l'abonnement inclut cinq comptes", () => {
    expect(MAX_ACCOUNTS).toBe(5);
  });

  it("crée jusqu'au cinquième compte, refuse le sixième (422 account_limit)", async () => {
    await fill();
    const refused = await create(6);
    expect(refused.status).toBe(422);
    expect(refused.body.error).toEqual({
      code: "account_limit",
      message:
        "L'abonnement inclut 5 comptes et ils sont tous attribués : supprimez un compte pour en ajouter un autre.",
      details: { limit: 5 },
    });
    expect(await count()).toBe(MAX_ACCOUNTS);
    const list = await call<User[]>("GET", "/users");
    expect(list.body.map((u) => u.email)).not.toContain("personne6@inovallee.com");
    const audits = await call<AuditEvent[]>("GET", "/audit?entity=user");
    expect(audits.body.filter((e) => e.details.includes("personne6@"))).toEqual([]);
  });

  it("supprimer un compte libère une place", async () => {
    await fill();
    expect((await create(6)).status).toBe(422);
    expect((await call("DELETE", `/users/${USERS.lecteur}`)).status).toBe(204);
    expect((await create(6)).status).toBe(201);
    expect((await create(7)).status).toBe(422);
    expect(await count()).toBe(MAX_ACCOUNTS);
  });

  it("au plafond, une adresse déjà utilisée reste signalée comme telle (409)", async () => {
    await fill();
    const res = await call<ApiErrorBody>("POST", "/users", {
      body: { name: "Doublon", email: "sophie.martin@inovallee.com", roles: ["lecteur"] },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("email_taken");
  });

  it("au plafond, un corps invalide reste une erreur de validation (400)", async () => {
    await fill();
    const res = await call<ApiErrorBody>("POST", "/users", { body: { ...person(6), roles: [] } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
  });

  it("au plafond, un non-administrateur reçoit 403, pas l'état du plafond", async () => {
    await fill();
    const res = await create(6, { user: USERS.redacteur });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("forbidden");
  });

  it("deux créations simultanées pour une seule place : un seul compte créé", async () => {
    const before = await count();
    for (let n = before + 1; n < MAX_ACCOUNTS; n++) expect((await create(n)).status).toBe(201);
    expect(await count()).toBe(MAX_ACCOUNTS - 1);

    const results = await Promise.all([create(8), create(9)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)?.body.error.code).toBe("users_busy");
    expect(await count()).toBe(MAX_ACCOUNTS);
    expect((await create(9)).status).toBe(422);
  });

  it("au plafond, modifier et supprimer un compte restent possibles", async () => {
    await fill();
    const patched = await call<User>("PATCH", `/users/${USERS.lecteur}`, {
      body: { team: "Direction", roles: ["validateur"] },
    });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ team: "Direction", roles: ["validateur"] });
    expect((await call("POST", `/users/${USERS.lecteur}/invite`)).status).toBe(200);
    expect((await call("DELETE", `/users/${USERS.lecteur}`)).status).toBe(204);
  });

  it("une base déjà au-dessus du plafond garde ses comptes ; seule la création est refusée", async () => {
    for (let n = (await count()) + 1; n <= MAX_ACCOUNTS + 2; n++) {
      await repo.users.insert(record(n));
    }
    expect(await count()).toBe(MAX_ACCOUNTS + 2);

    expect((await create(20)).status).toBe(422);
    const list = await call<User[]>("GET", "/users");
    expect(list.body).toHaveLength(MAX_ACCOUNTS + 2);
    expect((await call("PATCH", `/users/u_direct_7`, { body: { team: "Presse" } })).status).toBe(
      200,
    );

    // Il faut redescendre sous le plafond pour pouvoir créer de nouveau.
    expect((await call("DELETE", "/users/u_direct_7")).status).toBe(204);
    expect((await call("DELETE", "/users/u_direct_6")).status).toBe(204);
    expect((await create(20)).status).toBe(422);
    expect((await call("DELETE", "/users/u_direct_5")).status).toBe(204);
    expect((await create(20)).status).toBe(201);
  });
});

describe("plafond de comptes (mode supabase)", () => {
  it("un compte invité compte avant d'être activé ; au plafond, aucune invitation ne part", async () => {
    const fake = useFakeSupabaseAuth();
    const sophie = (await repo.users.get(USERS.admin))!;
    const account = fake.addAccount(sophie.email);
    await repo.users.update({ ...sophie, authUserId: account.id, activatedAt: NOW.toISOString() });
    const asAdmin = { headers: bearer(fake.tokenFor(account.id)) };

    await fill(asAdmin);
    const invitesAtLimit = fake.invites.length;
    const accountsAtLimit = fake.accounts.size;
    expect(invitesAtLimit).toBeGreaterThan(0);
    const pending = (await call<User[]>("GET", "/users", asAdmin)).body.filter(
      (u) => u.hasAccount === false,
    );
    expect(pending.length).toBeGreaterThan(0);

    const refused = await create(6, asAdmin);
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe("account_limit");
    expect(fake.invites).toHaveLength(invitesAtLimit);
    expect(fake.accounts.size).toBe(accountsAtLimit);
    expect(await count()).toBe(MAX_ACCOUNTS);
  });

  it("l'amorçage du premier administrateur n'est pas soumis au plafond", async () => {
    const fake = useFakeSupabaseAuth();
    for (let n = (await count()) + 1; n <= MAX_ACCOUNTS; n++) await repo.users.insert(record(n));
    expect(await count()).toBe(MAX_ACCOUNTS);

    vi.stubEnv("KORA_ADMIN_EMAILS", "direction@example.com");
    const account = fake.addAccount("direction@example.com");
    const me = await call<User>("GET", "/me", { headers: bearer(fake.tokenFor(account.id)) });
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ email: "direction@example.com", roles: ["admin"] });
    expect(await count()).toBe(MAX_ACCOUNTS + 1);
  });
});
