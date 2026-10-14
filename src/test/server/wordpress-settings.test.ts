import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WordPressStatus } from "@/lib/api/types";
import { DbRepository } from "@/server/store/db";
import type { Settings } from "@/server/store/records";
import type { Repository } from "@/server/store/repository";
import { call, setup, teardown, USERS } from "./helpers";

/** Table `kora_settings` en mémoire : une ligne par espace de travail, colonne `data` (jsonb). */
class FakeSettingsTable {
  data: unknown = null;
  upserts: { workspace_id: string; data: unknown }[] = [];

  from(table: string) {
    expect(table).toBe("kora_settings");
    return {
      select: (columns: string) => {
        expect(columns).toBe("data");
        return {
          eq: () => ({
            single: async () => ({ data: { data: structuredClone(this.data) }, error: null }),
          }),
        };
      },
      upsert: async (row: { workspace_id: string; data: unknown }) => {
        this.upserts.push(structuredClone(row));
        this.data = structuredClone(row.data);
        return { error: null };
      },
    };
  }
}

const fake = vi.hoisted(() => ({ current: null as { from(table: string): unknown } | null }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => fake.current!.from(table) },
}));

const DEFAULTS = { categoryMap: {}, defaultCategory: null };

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

const malformed: [string, unknown, Settings["wordpress"]][] = [
  ["absent (réglages antérieurs)", undefined, DEFAULTS],
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

describe("Settings.wordpress lu avec tolérance (mémoire)", () => {
  it.each(malformed)("%s", async (_label, value, expected) => {
    await repo.saveSettings(withWordPress(value));
    const settings = await repo.getSettings();
    expect(settings.wordpress).toEqual(expected);
    expect(settings.quotaLimits).toEqual(legacy.quotaLimits);
    const status = await call<WordPressStatus>("GET", "/wordpress", { user: USERS.lecteur });
    expect(status.status).toBe(200);
    expect(status.body.settings).toEqual(expected);
  });

  it("l'enregistrement de la correspondance conserve les autres réglages", async () => {
    await repo.saveSettings({ ...withWordPress(undefined), reservedEur: 1.5 });
    const res = await call("PUT", "/wordpress/settings", {
      body: { categoryMap: { Brevet: "brevets" }, defaultCategory: null },
      user: USERS.admin,
    });
    expect(res.status).toBe(200);
    const settings = await repo.getSettings();
    expect(settings.reservedEur).toBe(1.5);
    expect(settings.wordpress).toEqual({
      categoryMap: { Brevet: "brevets" },
      defaultCategory: null,
    });
  });
});

describe("Settings.wordpress lu avec tolérance (base Supabase)", () => {
  let table: FakeSettingsTable;
  let db: DbRepository;

  beforeEach(() => {
    table = new FakeSettingsTable();
    fake.current = table;
    db = new DbRepository();
  });

  it.each(malformed)("%s", async (_label, value, expected) => {
    table.data = withWordPress(value);
    const settings = await db.getSettings();
    expect(settings.wordpress).toEqual(expected);
    expect(settings).toMatchObject(legacy);
  });

  it("enregistre la correspondance dans la ligne de réglages existante", async () => {
    table.data = withWordPress(undefined);
    const current = await db.getSettings();
    const wordpress = { categoryMap: { Brevet: "brevets" }, defaultCategory: "actualites" };
    await db.saveSettings({ ...current, wordpress });
    expect(table.upserts).toHaveLength(1);
    expect(table.upserts[0]!.data).toEqual({ ...legacy, wordpress });
    expect((await db.getSettings()).wordpress).toEqual(wordpress);
  });
});
