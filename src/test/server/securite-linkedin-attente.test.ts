import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setClock } from "@/server/clock";
import {
  consumePendingConnect,
  discardPendingConnect,
  openPendingConnect,
  PENDING_CONNECT_TTL_MS,
} from "@/server/linkedin/pendingConnect";
import { DbRepository } from "@/server/store/db";
import { resetStore } from "@/server/store/memory";
import type { Repository } from "@/server/store/repository";
import { NOW } from "./helpers";

interface Row {
  collection: string;
  id: string;
  data: Record<string, unknown>;
}

/**
 * `kora_records` en mémoire : PK (collection, id) => 23505, upsert sur cette PK, filtres `eq`
 * dont `data->>champ`.
 */
class FakeRecords {
  rows = new Map<string, Row>();

  from(name: string) {
    expect(name).toBe("kora_records");
    return {
      insert: async (row: Row) => {
        const key = `${row.collection}|${row.id}`;
        if (this.rows.has(key)) return { error: { code: "23505", message: "duplicate key" } };
        this.rows.set(key, structuredClone(row));
        return { error: null };
      },
      upsert: async (row: Row, options: { onConflict?: string }) => {
        expect(options).toEqual({ onConflict: "collection,id" });
        this.rows.set(`${row.collection}|${row.id}`, structuredClone(row));
        return { error: null };
      },
      select: () => this.query(),
      delete: () => this.query(),
    };
  }

  private query() {
    const filters: [string, unknown][] = [];
    const matches = () =>
      [...this.rows.entries()].filter(([, row]) =>
        filters.every(([column, value]) =>
          column.startsWith("data->>")
            ? row.data[column.slice("data->>".length)] === value
            : row[column as "collection" | "id"] === value,
        ),
      );
    const builder = {
      eq: (column: string, value: unknown) => {
        filters.push([column, value]);
        return builder;
      },
      maybeSingle: async () => {
        const found = matches()[0];
        return { data: found ? { data: structuredClone(found[1].data) } : null, error: null };
      },
      then: (resolve: (r: { error: null }) => unknown) => {
        for (const [key] of matches()) this.rows.delete(key);
        return Promise.resolve({ error: null }).then(resolve);
      },
    };
    return builder;
  }
}

const fake = vi.hoisted(() => ({ current: null as { from(name: string): unknown } | null }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (name: string) => fake.current!.from(name) },
}));

let records: FakeRecords;
const at = (ms: number) => setClock(() => new Date(NOW.getTime() + ms));

beforeEach(() => {
  records = new FakeRecords();
  fake.current = records;
  at(0);
});
afterEach(() => {
  fake.current = null;
  setClock(null);
});

describe.each([
  ["dépôt en mémoire (Vitest)", (): Repository => resetStore({ now: NOW })],
  ["dépôt en base (production)", (): Repository => new DbRepository()],
])("F3 — connexion LinkedIn en attente : %s", (_label, makeRepo) => {
  let repo: Repository;
  beforeEach(() => {
    repo = makeRepo();
  });

  it("consommable une seule fois, par son seul utilisateur", async () => {
    const state = await openPendingConnect(repo, "u_claire");
    expect(await consumePendingConnect(repo, "u_lucas", state)).toBe(false);
    expect(await consumePendingConnect(repo, "u_claire", state)).toBe(true);
    expect(await consumePendingConnect(repo, "u_claire", state)).toBe(false);
  });

  it("expire après 10 minutes", async () => {
    const kept = await openPendingConnect(repo, "u_claire");
    at(PENDING_CONNECT_TTL_MS - 1);
    expect(await consumePendingConnect(repo, "u_claire", kept)).toBe(true);
    const expired = await openPendingConnect(repo, "u_claire");
    at(2 * PENDING_CONNECT_TTL_MS - 1);
    expect(await consumePendingConnect(repo, "u_claire", expired)).toBe(false);
  });

  it("jeton falsifié ou état mal formé : refus, l'attente reste valable", async () => {
    const state = await openPendingConnect(repo, "u_claire");
    expect(state).toMatch(/^[0-9a-f-]{36}$/);
    const forged = [
      "faux",
      state.replace(/^./, (c) => (c === "0" ? "1" : "0")),
      "",
      `${state}.x`,
      `${state}.${state}`,
      "a:b.c",
      "x".repeat(65),
    ];
    for (const attempt of forged) {
      expect(await consumePendingConnect(repo, "u_claire", attempt)).toBe(false);
    }
    expect(await consumePendingConnect(repo, "u_claire", state)).toBe(true);
  });

  it("N5 — une seule attente par utilisateur : chaque ouverture invalide la précédente", async () => {
    const states: string[] = [];
    for (let i = 0; i < 20; i++) states.push(await openPendingConnect(repo, "u_claire"));
    const other = await openPendingConnect(repo, "u_lucas");
    expect(new Set(states).size).toBe(20);
    for (const old of states.slice(0, -1)) {
      expect(await consumePendingConnect(repo, "u_claire", old)).toBe(false);
    }
    expect(await consumePendingConnect(repo, "u_claire", states.at(-1)!)).toBe(true);
    expect(await consumePendingConnect(repo, "u_lucas", other)).toBe(true);
  });

  it("N5 — l'attente d'un utilisateur supprimé est effacée, quel que soit son jeton", async () => {
    const state = await openPendingConnect(repo, "u_claire");
    const other = await openPendingConnect(repo, "u_lucas");
    await discardPendingConnect(repo, "u_claire");
    await discardPendingConnect(repo, "u_marc");
    expect(await consumePendingConnect(repo, "u_claire", state)).toBe(false);
    expect(await consumePendingConnect(repo, "u_lucas", other)).toBe(true);
  });

  it("replaceLock évince un détenteur non expiré : son jeton ne libère plus rien", async () => {
    const held = (await repo.acquireLock("cle", 60_000))!;
    const replaced = await repo.replaceLock("cle", 60_000);
    expect(replaced).not.toBe(held);
    await repo.releaseLock("cle", held);
    expect(await repo.acquireLock("cle", 60_000)).toBeNull();
    await repo.releaseLock("cle", replaced);
    expect(await repo.acquireLock("cle", 60_000)).toEqual(expect.any(String));
  });

  it("finalisation déjà en cours pour cet utilisateur (autre instance) : refus sans consommer", async () => {
    const state = await openPendingConnect(repo, "u_claire");
    const guard = await repo.acquireLock("linkedin-connect-consume:u_claire", 15_000);
    expect(await consumePendingConnect(repo, "u_claire", state)).toBe(false);
    await repo.releaseLock("linkedin-connect-consume:u_claire", guard!);
    expect(await consumePendingConnect(repo, "u_claire", state)).toBe(true);
  });
});

// En parallèle, Vitest sert parfois le vrai module aux `import()` dynamiques simulés de
// DbRepository : la concurrence réelle n'est donc rejouée que sur le dépôt en mémoire.
describe("F3 — finalisations simultanées (dépôt en mémoire)", () => {
  it("une seule réussit", async () => {
    const repo = resetStore({ now: NOW });
    const state = await openPendingConnect(repo, "u_claire");
    const results = await Promise.all(
      Array.from({ length: 5 }, () => consumePendingConnect(repo, "u_claire", state)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

describe("F3 — attente en base : aucune ligne laissée derrière", () => {
  it("consommation, refus et expiration ne laissent aucun verrou", async () => {
    const repo = new DbRepository();
    const consumed = await openPendingConnect(repo, "u_claire");
    expect(records.rows.size).toBe(1);
    expect(await consumePendingConnect(repo, "u_claire", consumed)).toBe(true);
    expect(await consumePendingConnect(repo, "u_lucas", consumed)).toBe(false);
    expect(records.rows.size).toBe(0);

    const stale = await openPendingConnect(repo, "u_claire");
    at(PENDING_CONNECT_TTL_MS);
    expect(await consumePendingConnect(repo, "u_claire", stale)).toBe(false);
    expect(records.rows.size).toBe(0);
  });

  it("N5 — clics « Connecter » répétés sans finalisation : une seule ligne par utilisateur", async () => {
    const repo = new DbRepository();
    let last = "";
    for (let i = 0; i < 20; i++) last = await openPendingConnect(repo, "u_claire");
    await openPendingConnect(repo, "u_lucas");
    expect([...records.rows.keys()].sort()).toEqual([
      "locks|linkedin-connect:u_claire",
      "locks|linkedin-connect:u_lucas",
    ]);
    expect(records.rows.get("locks|linkedin-connect:u_claire")!.data["token"]).toBe(last);

    expect(await consumePendingConnect(repo, "u_claire", last)).toBe(true);
    await discardPendingConnect(repo, "u_lucas");
    expect(records.rows.size).toBe(0);
  });
});
