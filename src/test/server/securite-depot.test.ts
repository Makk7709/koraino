import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sous-ensemble de supabase-js utilisé par `DbRepository.ensureReady` et par la suppression
 * d'une connexion LinkedIn.
 */
const fake = vi.hoisted(() => ({
  workspace: null as { workspace_id: string } | null,
  records: [] as { collection: string; id: string }[],
  settings: [] as unknown[],
  deletions: [] as [string, unknown][][],
  deleteError: null as { message: string } | null,
  initializeError: null as { code: string } | null,
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc(name: string, args: { p_data: unknown }) {
      expect(name).toBe("kora_settings_initialize");
      return {
        abortSignal: async (_signal: AbortSignal) => {
          if (!fake.initializeError) fake.settings.push(args.p_data);
          return { data: !fake.initializeError, error: fake.initializeError };
        },
      };
    },
    from(table: string) {
      if (table === "app_user_connections") {
        return {
          delete: () => {
            const filters: [string, unknown][] = [];
            const query = {
              eq: (column: string, value: unknown) => {
                filters.push([column, value]);
                return query;
              },
              then: (resolve: (r: { error: { message: string } | null }) => unknown) => {
                if (!fake.deleteError) fake.deletions.push(filters);
                return Promise.resolve({ error: fake.deleteError }).then(resolve);
              },
            };
            return query;
          },
        };
      }
      if (table === "kora_settings") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: fake.workspace, error: null }) }),
          }),
          upsert: () => {
            throw new Error("Direct settings writes forbidden");
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

import { deleteConnectionKeyForUser } from "@/server/appUserConnections.server";
import { authMode } from "@/server/auth/mode";
import { usesDatabase } from "@/server/database";
import { HttpError } from "@/server/http";
import { DbRepository } from "@/server/store/db";
import { getRepository, resetStore } from "@/server/store/memory";

beforeEach(() => {
  fake.workspace = null;
  fake.records = [];
  fake.settings = [];
  fake.deletions = [];
  fake.deleteError = null;
  fake.initializeError = null;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
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

  it("refuse le démarrage si la RPC d'initialisation échoue, puis permet une reprise", async () => {
    const repo = new DbRepository();
    fake.initializeError = { code: "42501" };
    await expect(repo.ensureReady()).rejects.toThrow("Settings initialization failed: 42501");
    expect(fake.settings).toHaveLength(0);
    fake.initializeError = null;
    await repo.ensureReady();
    expect(fake.settings).toHaveLength(1);
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

describe("N3 — suppression d'une connexion LinkedIn en base", () => {
  beforeEach(() => {
    vi.stubEnv("VITEST", "");
    vi.stubEnv("SUPABASE_URL", "https://projet.supabase.invalid");
  });

  it("supprime la ligne de cet utilisateur et de ce connecteur", async () => {
    await deleteConnectionKeyForUser("u_claire", "linkedin");
    expect(fake.deletions).toEqual([
      [
        ["user_id", "u_claire"],
        ["connector_id", "linkedin"],
      ],
    ]);
  });

  it("base en panne : 503 linkedin_unavailable, pas une erreur interne", async () => {
    fake.deleteError = { message: "connexion refusée" };
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = await deleteConnectionKeyForUser("u_claire", "linkedin").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({
      status: 503,
      code: "linkedin_unavailable",
      message: "Connexion LinkedIn impossible à supprimer pour le moment : réessayez plus tard.",
    });
    expect(logged).toHaveBeenCalledWith(
      "[app_user_connections] suppression impossible :",
      fake.deleteError,
    );
    expect(fake.deletions).toEqual([]);
  });
});
