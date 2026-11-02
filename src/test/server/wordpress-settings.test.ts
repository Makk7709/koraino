import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiErrorBody, WordPressSettings, WordPressStatus } from "@/lib/api/types";
import { DbRepository } from "@/server/store/db";
import type { Settings } from "@/server/store/records";
import type { Repository } from "@/server/store/repository";
import { call, setup, teardown, USERS } from "./helpers";

type PgError = { code: string; message: string };
interface RecordRow {
  collection: string;
  id: string;
  data: unknown;
}

/**
 * Sous-ensemble de supabase-js utilisé par les réglages : `kora_settings` (une ligne, colonne
 * `data`) et `kora_records` (PK collection + id : insertion en conflit => 23505, upsert sur la PK).
 */
class FakeTables {
  settings: unknown = null;
  records = new Map<string, unknown>();
  log: string[] = [];
  insertError: PgError | null = null;

  record(collection: string, id: string) {
    return this.records.get(`${collection}|${id}`);
  }

  rpc(name: string, args: { p_data: Settings }) {
    expect(name).toBe("kora_settings_save");
    this.log.push("settings.rpc");
    const existing = (this.settings ?? {}) as Record<string, unknown>;
    const { wordpress: _unused, ...next } = args.p_data;
    const previousAlerts = Array.isArray(existing["notifiedAlerts"])
      ? (existing["notifiedAlerts"] as string[])
      : [];
    this.settings = {
      ...Object.fromEntries(Object.entries(existing).filter(([key]) => key !== "wordpress")),
      quotaLimits: structuredClone(next.quotaLimits),
      storageBaseGb: next.storageBaseGb,
      notifiedAlerts: [...new Set([...previousAlerts, ...next.notifiedAlerts])].sort(),
    };
    return Promise.resolve({ data: true, error: null });
  }

  from(table: string) {
    if (table === "kora_settings") return this.settingsTable();
    expect(table).toBe("kora_records");
    return this.recordsTable();
  }

  private settingsTable() {
    const read = async () => {
      this.log.push("settings.select");
      const data = this.settings === null ? null : { data: structuredClone(this.settings) };
      return { data, error: null };
    };
    return {
      select: (columns: string) => {
        expect(columns).toBe("data");
        const query = { eq: () => query, single: read, maybeSingle: read };
        return query;
      },
      upsert: async (row: { workspace_id: string; data: unknown }) => {
        this.log.push("settings.upsert");
        this.settings = structuredClone(row.data);
        return { error: null };
      },
    };
  }

  private recordsTable() {
    return {
      select: (columns: string) => {
        expect(columns).toBe("data");
        const filters: Record<string, string> = {};
        const query = {
          eq: (column: string, value: string) => {
            filters[column] = value;
            return query;
          },
          maybeSingle: async () => {
            this.log.push("records.select");
            const found = this.record(filters["collection"]!, filters["id"]!);
            return {
              data: found === undefined ? null : { data: structuredClone(found) },
              error: null,
            };
          },
        };
        return query;
      },
      insert: async (row: RecordRow) => {
        this.log.push("records.insert");
        if (this.insertError) return { error: this.insertError };
        const key = `${row.collection}|${row.id}`;
        if (this.records.has(key)) {
          return {
            error: {
              code: "23505",
              message: 'duplicate key value violates unique constraint "kora_records_pkey"',
            },
          };
        }
        this.records.set(key, structuredClone(row.data));
        return { error: null };
      },
      upsert: async (row: RecordRow, options: { onConflict: string }) => {
        expect(options).toEqual({ onConflict: "collection,id" });
        this.log.push("records.upsert");
        this.records.set(`${row.collection}|${row.id}`, structuredClone(row.data));
        return { error: null };
      },
    };
  }
}

const fake = vi.hoisted(() => ({ current: null as FakeTables | null }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => fake.current!.from(table),
    rpc: (name: string, args: { p_data: Settings }) => fake.current!.rpc(name, args),
  },
}));

const DEFAULTS: WordPressSettings = { categoryMap: {}, defaultCategory: null };
const MAPPING: WordPressSettings = {
  categoryMap: { Brevet: "brevets" },
  defaultCategory: "actualites",
};
const OLD: WordPressSettings = { categoryMap: { Innovation: "innovation" }, defaultCategory: null };

let repo: Repository;
let legacy: Omit<Settings, "wordpress">;

beforeEach(async () => {
  repo = setup();
  const { wordpress: _ignored, ...rest } = await repo.getSettings();
  legacy = rest;
});
afterEach(() => {
  fake.current = null;
  teardown();
});

const malformed: [string, unknown, WordPressSettings][] = [
  ["absente (réglages antérieurs)", undefined, DEFAULTS],
  ["null", null, DEFAULTS],
  ["chaîne", "financement", DEFAULTS],
  ["tableau", [], DEFAULTS],
  ["correspondance non objet", { categoryMap: "x", defaultCategory: 3 }, DEFAULTS],
  [
    "valeurs partiellement invalides",
    {
      categoryMap: { "Levée de fonds": "financement", Innovation: 4, Brevet: "" },
      defaultCategory: "actualites",
    },
    { categoryMap: { "Levée de fonds": "financement" }, defaultCategory: "actualites" },
  ],
];

const withWordPress = (value: unknown) =>
  (value === undefined ? { ...legacy } : { ...legacy, wordpress: value }) as Settings;

const saveMapping = (body: unknown) =>
  call<WordPressStatus & ApiErrorBody>("PUT", "/wordpress/settings", { body, user: USERS.admin });

describe("Correspondance des catégories WordPress hors des réglages partagés (mémoire)", () => {
  it.each(malformed)(
    "ancien emplacement lu avec tolérance : %s",
    async (_label, value, expected) => {
      await repo.saveSettings(withWordPress(value));
      expect(await repo.getWordPressSettings()).toEqual(expected);
      const settings = await repo.getSettings();
      expect(settings.wordpress).toBeUndefined();
      expect(settings.quotaLimits).toEqual(legacy.quotaLimits);
      const status = await call<WordPressStatus>("GET", "/wordpress", { user: USERS.lecteur });
      expect(status.status).toBe(200);
      expect(status.body.settings).toEqual(expected);
    },
  );

  it("l'enregistrement de la correspondance ne réécrit pas les réglages partagés", async () => {
    await repo.saveSettings({ ...withWordPress(undefined), reservedEur: 1.5 });
    const res = await saveMapping(MAPPING);
    expect(res.status).toBe(200);
    expect(res.body.settings).toEqual(MAPPING);
    expect(await repo.getWordPressSettings()).toEqual(MAPPING);
    const settings = await repo.getSettings();
    expect(settings.reservedEur).toBe(1.5);
    expect(settings.wordpress).toBeUndefined();
  });

  it("une écriture des réglages partagés lus avant l'enregistrement n'écrase plus la correspondance", async () => {
    const stale = await repo.getSettings();
    expect((await saveMapping(MAPPING)).status).toBe(200);
    await repo.saveSettings({ ...stale, reservedEur: 2 });
    await repo.saveSettings({ ...stale, wordpress: DEFAULTS, reservedEur: 3 });
    const status = await call<WordPressStatus>("GET", "/wordpress", { user: USERS.lecteur });
    expect(status.body.settings).toEqual(MAPPING);
    expect(await repo.getWordPressSettings()).toEqual(MAPPING);
    expect((await repo.getSettings()).reservedEur).toBe(3);
  });

  it("migration : l'ancienne correspondance est reprise, puis remplacée par le nouvel enregistrement", async () => {
    await repo.saveSettings(withWordPress(OLD));
    expect(await repo.getWordPressSettings()).toEqual(OLD);
    expect((await saveMapping(MAPPING)).status).toBe(200);
    await repo.saveSettings(withWordPress(OLD));
    expect(await repo.getWordPressSettings()).toEqual(MAPPING);
  });

  it("enregistrement concurrent : 409 wordpress_settings_in_progress, rien n'est écrit", async () => {
    const token = await repo.acquireLock("wordpress-settings", 30_000);
    expect(token).not.toBeNull();
    const auditBefore = (await repo.audit.list()).length;
    const res = await saveMapping(MAPPING);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("wordpress_settings_in_progress");
    expect(await repo.getWordPressSettings()).toEqual(DEFAULTS);
    expect(await repo.audit.list()).toHaveLength(auditBefore);

    await repo.releaseLock("wordpress-settings", token!);
    expect((await saveMapping(MAPPING)).status).toBe(200);
    expect((await saveMapping(OLD)).status).toBe(200);
    expect(await repo.getWordPressSettings()).toEqual(OLD);
  });
});

describe("Correspondance des catégories WordPress hors des réglages partagés (base Supabase)", () => {
  let tables: FakeTables;
  let db: DbRepository;

  beforeEach(() => {
    tables = new FakeTables();
    fake.current = tables;
    db = new DbRepository();
  });

  it.each(malformed)("ancien emplacement lu en secours : %s", async (_label, value, expected) => {
    tables.settings = withWordPress(value);
    expect(await db.getWordPressSettings()).toEqual(expected);
    expect(tables.log).toEqual(["records.select", "settings.select"]);
    expect(await db.getSettings()).toMatchObject(legacy);
  });

  it("enregistre la correspondance dans `kora_records` (config/wordpress), sans toucher `kora_settings`", async () => {
    tables.settings = withWordPress(OLD);
    await db.saveWordPressSettings(MAPPING);
    expect(tables.record("config", "wordpress")).toEqual(MAPPING);
    expect(tables.log).toEqual(["records.upsert"]);
    expect(tables.settings).toEqual(withWordPress(OLD));
    expect(await db.getWordPressSettings()).toEqual(MAPPING);
  });

  it("une écriture des réglages partagés lus avant l'enregistrement n'écrase plus la correspondance", async () => {
    tables.settings = withWordPress(DEFAULTS);
    const stale = await db.getSettings();
    await db.saveWordPressSettings(MAPPING);
    await db.saveSettings({ ...stale, reservedEur: 2 });
    expect(await db.getWordPressSettings()).toEqual(MAPPING);
    expect(tables.settings).toEqual({ ...legacy });
  });

  it("migration : l'ancienne correspondance est recopiée au prochain enregistrement des réglages, puis retirée", async () => {
    tables.settings = withWordPress(OLD);
    expect(await db.getWordPressSettings()).toEqual(OLD);
    const current = await db.getSettings();
    tables.log = [];
    await db.saveSettings({ ...current, reservedEur: 1 });
    expect(tables.log).toEqual(["records.insert", "settings.rpc"]);
    expect(tables.record("config", "wordpress")).toEqual(OLD);
    expect(tables.settings).toEqual({ ...legacy });
    expect(await db.getWordPressSettings()).toEqual(OLD);
  });

  it("une sauvegarde obsolète ne supprime pas la réserve, la suspension ni les alertes", async () => {
    tables.settings = { ...legacy, reservedEur: 0, notifiedAlerts: [] };
    const stale = await db.getSettings();
    tables.settings = {
      ...legacy,
      reservedEur: 0.02,
      paidCallsSuspended: true,
      suspendedMonth: "2026-10",
      notifiedAlerts: ["2026-10:api_budget_eur:atteint"],
    };
    await db.saveSettings({
      ...stale,
      reservedEur: 0,
      notifiedAlerts: ["2026-10:articles:seuil_80"],
    });
    expect(tables.settings).toMatchObject({
      reservedEur: 0.02,
      paidCallsSuspended: true,
      suspendedMonth: "2026-10",
      notifiedAlerts: ["2026-10:api_budget_eur:atteint", "2026-10:articles:seuil_80"],
    });
    expect(tables.log).toContain("settings.rpc");
  });

  it("recopie en échec : la ligne de réglages n'est pas réécrite et garde l'ancienne correspondance", async () => {
    tables.settings = withWordPress(OLD);
    const current = await db.getSettings();
    tables.insertError = { code: "57014", message: "canceling statement due to statement timeout" };
    await expect(db.saveSettings({ ...current, reservedEur: 1 })).rejects.toThrow(
      "statement timeout",
    );
    expect(tables.settings).toEqual(withWordPress(OLD));
    tables.insertError = null;
    expect(await db.getWordPressSettings()).toEqual(OLD);
  });
});
