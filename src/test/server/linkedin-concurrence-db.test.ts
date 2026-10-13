import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setClock } from "@/server/clock";
import { DbRepository } from "@/server/store/db";
import { NOW } from "./helpers";

interface Row {
  collection: string;
  id: string;
  data: Record<string, unknown>;
}
type PgError = { code: string; message: string };

/**
 * Sous-ensemble de supabase-js utilisé par le verrou, sur une table `kora_records` en
 * mémoire : PK (collection, id), conflit => code 23505, filtres `eq` dont `data->>champ`.
 */
class FakeSupabase {
  rows = new Map<string, Row>();
  log: string[] = [];
  /** Appelé après chaque lecture : simule une autre instance qui agit entre deux requêtes. */
  afterSelect: (() => void) | null = null;
  afterConflict: (() => void) | null = null;
  insertError: PgError | null = null;

  private static key(collection: string, id: string) {
    return `${collection}|${id}`;
  }

  put(row: Row) {
    this.rows.set(FakeSupabase.key(row.collection, row.id), structuredClone(row));
  }

  lock(id: string) {
    return this.rows.get(FakeSupabase.key("locks", id))?.data;
  }

  dropLock(id: string) {
    this.rows.delete(FakeSupabase.key("locks", id));
  }

  from(table: string) {
    expect(table).toBe("kora_records");
    return {
      insert: async (row: Row) => {
        this.log.push("insert");
        if (this.insertError) return { error: this.insertError };
        if (this.rows.has(FakeSupabase.key(row.collection, row.id))) {
          this.afterConflict?.();
          return {
            error: {
              code: "23505",
              message: 'duplicate key value violates unique constraint "kora_records_pkey"',
            },
          };
        }
        this.put(row);
        return { error: null };
      },
      select: () => this.query("select"),
      delete: () => this.query("delete"),
    };
  }

  private query(op: "select" | "delete") {
    const filters: [string, string][] = [];
    const matches = () =>
      [...this.rows.values()].filter((row) =>
        filters.every(([column, value]) => {
          const actual = column.startsWith("data->>")
            ? row.data[column.slice("data->>".length)]
            : row[column as "collection" | "id"];
          return actual === value;
        }),
      );
    const builder = {
      eq: (column: string, value: string) => {
        filters.push([column, value]);
        return builder;
      },
      maybeSingle: async () => {
        expect(op).toBe("select");
        this.log.push("select");
        const found = matches()[0];
        const data = found ? { data: structuredClone(found.data) } : null;
        this.afterSelect?.();
        return { data, error: null };
      },
      then: (resolve: (r: { error: null; count: number }) => unknown) => {
        expect(op).toBe("delete");
        const found = matches();
        this.log.push(`delete:${found.length}`);
        for (const row of found) this.rows.delete(FakeSupabase.key(row.collection, row.id));
        return Promise.resolve({ error: null, count: found.length }).then(resolve);
      },
    };
    return builder;
  }
}

const fake = vi.hoisted(() => ({ current: null as { from(table: string): unknown } | null }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => fake.current!.from(table) },
}));

const KEY = "linkedin-publish:li_x:v3";
const at = (ms: number) => setClock(() => new Date(NOW.getTime() + ms));

let supabase: FakeSupabase;
let repo: DbRepository;

beforeEach(() => {
  supabase = new FakeSupabase();
  fake.current = supabase;
  repo = new DbRepository();
  at(0);
});
afterEach(() => {
  fake.current = null;
  setClock(null);
});

describe("DbRepository : verrou sur kora_records", () => {
  it("insère une ligne `locks` sans upsert et la supprime à la libération", async () => {
    const token = await repo.acquireLock(KEY, 120_000);
    expect(token).toEqual(expect.any(String));
    expect(supabase.log).toEqual(["insert"]);
    expect(supabase.lock(KEY)).toEqual({
      id: KEY,
      token,
      expiresAt: new Date(NOW.getTime() + 120_000).toISOString(),
    });

    await repo.releaseLock(KEY, token!);
    expect(supabase.lock(KEY)).toBeUndefined();
  });

  it("conflit 23505 sur un verrou valide : refus, sans suppression ni nouvelle insertion", async () => {
    const holder = await repo.acquireLock(KEY, 120_000);
    supabase.log = [];
    at(119_999);
    expect(await repo.acquireLock(KEY, 120_000)).toBeNull();
    expect(supabase.log).toEqual(["insert", "select"]);
    expect(supabase.lock(KEY)?.["token"]).toBe(holder);
  });

  it("verrou expiré : suppression conditionnelle puis une seule nouvelle tentative", async () => {
    const stale = await repo.acquireLock(KEY, 120_000);
    supabase.log = [];
    at(120_000);
    const token = await repo.acquireLock(KEY, 120_000);
    expect(token).not.toBeNull();
    expect(token).not.toBe(stale);
    expect(supabase.log).toEqual(["insert", "select", "delete:1", "insert"]);
    expect(supabase.lock(KEY)).toMatchObject({
      token,
      expiresAt: new Date(NOW.getTime() + 240_000).toISOString(),
    });
  });

  it("verrou expiré repris par une autre instance entre-temps : aucune suppression, refus", async () => {
    await repo.acquireLock(KEY, 1000);
    supabase.log = [];
    at(5000);
    const other = {
      collection: "locks",
      id: KEY,
      data: {
        id: KEY,
        token: "autre-instance",
        expiresAt: new Date(NOW.getTime() + 125_000).toISOString(),
      },
    };
    supabase.afterSelect = () => supabase.put(other);

    expect(await repo.acquireLock(KEY, 120_000)).toBeNull();
    expect(supabase.log).toEqual(["insert", "select", "delete:0", "insert"]);
    expect(supabase.lock(KEY)?.["token"]).toBe("autre-instance");
  });

  it("verrou libéré entre le conflit et la lecture : nouvelle tentative unique", async () => {
    await repo.acquireLock(KEY, 120_000);
    supabase.log = [];
    supabase.afterConflict = () => {
      supabase.afterConflict = null;
      supabase.dropLock(KEY);
    };
    const token = await repo.acquireLock(KEY, 120_000);
    expect(token).not.toBeNull();
    expect(supabase.log).toEqual(["insert", "select", "insert"]);
    expect(supabase.lock(KEY)?.["token"]).toBe(token);
  });

  it("la libération avec un jeton périmé ne supprime pas le verrou du nouveau détenteur", async () => {
    const stale = await repo.acquireLock(KEY, 1000);
    at(1000);
    const fresh = await repo.acquireLock(KEY, 120_000);
    await repo.releaseLock(KEY, stale!);
    expect(supabase.lock(KEY)?.["token"]).toBe(fresh);
  });

  it("une autre erreur PostgreSQL est remontée telle quelle", async () => {
    supabase.insertError = { code: "42501", message: "permission denied for table kora_records" };
    await expect(repo.acquireLock(KEY, 120_000)).rejects.toThrow(
      "permission denied for table kora_records",
    );
  });
});
