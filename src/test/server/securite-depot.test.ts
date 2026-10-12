import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Sous-ensemble de supabase-js utilisé par `DbRepository.ensureReady`. */
const fake = vi.hoisted(() => ({
  workspace: null as { workspace_id: string } | null,
  records: [] as { collection: string; id: string }[],
  settings: [] as unknown[],
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from(table: string) {
      if (table === "kora_settings") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: fake.workspace, error: null }) }),
          }),
          upsert: async (row: unknown) => {
            fake.settings.push(row);
            return { error: null };
          },
        };
      }
      expect(table).toBe("kora_records");
      return {
        upsert: async (rows: { collection: string; id: string }[]) => {
          fake.records.push(...rows);
          return { error: null };
        },
      };
    },
  },
}));

import { authMode } from "@/server/auth/mode";
import { usesDatabase } from "@/server/database";
import { DbRepository } from "@/server/store/db";
import { getRepository, resetStore } from "@/server/store/memory";

beforeEach(() => {
  fake.workspace = null;
  fake.records = [];
  fake.settings = [];
});
afterEach(() => {
  vi.unstubAllEnvs();
  delete (globalThis as Record<string, unknown>)["__koraDb__"];
});

describe("E2 — aucun utilisateur de démonstration en production", () => {
  it("ensureReady installe grille, règles et réglages, sans aucun utilisateur", async () => {
    await new DbRepository().ensureReady();
    const collections = new Set(fake.records.map((r) => r.collection));
    expect([...collections].sort()).toEqual(["grids", "rules"]);
    expect(fake.records.some((r) => r.id.startsWith("u_"))).toBe(false);
    expect(fake.settings).toHaveLength(1);
  });

  it("ne réinstalle rien sur un espace déjà initialisé", async () => {
    fake.workspace = { workspace_id: "kora" };
    await new DbRepository().ensureReady();
    expect(fake.records).toHaveLength(0);
    expect(fake.settings).toHaveLength(0);
  });

  it("Vitest et le développement local gardent les 4 utilisateurs de démonstration", async () => {
    const ids = (await resetStore().users.list()).map((u) => u.id).sort();
    expect(ids).toEqual(["u_claire", "u_lucas", "u_marc", "u_sophie"]);
  });
});

describe("I4 — un seul prédicat pour la base et le mode d'authentification", () => {
  it("usesDatabase() décide à la fois de authMode() et de getRepository()", async () => {
    expect(usesDatabase()).toBe(false);
    expect(authMode()).toBe("demo");
    expect(await getRepository()).not.toBeInstanceOf(DbRepository);

    vi.stubEnv("VITEST", "");
    vi.stubEnv("SUPABASE_URL", "https://projet.supabase.invalid");
    expect(usesDatabase()).toBe(true);
    expect(authMode()).toBe("supabase");
    expect(await getRepository()).toBeInstanceOf(DbRepository);

    vi.stubEnv("SUPABASE_URL", "");
    expect(usesDatabase()).toBe(false);
    expect(authMode()).toBe("demo");
  });
});
