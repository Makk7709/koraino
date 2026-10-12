import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConnectionKeyUnavailableError,
  getConnectionKeyForUser,
} from "@/server/appUserConnections.server";
import { encryptConnectionKey } from "@/server/connectionKeyCrypto";
import { HttpError } from "@/server/http";

/** Réponse de `app_user_connections` servie au prochain `maybeSingle()`. */
const table = vi.hoisted(() => ({
  reply: { data: null, error: null } as { data: unknown; error: unknown },
  queries: 0,
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (name: string) => {
      expect(name).toBe("app_user_connections");
      table.queries += 1;
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => table.reply,
      };
      return query;
    },
  },
}));

const read = () => getConnectionKeyForUser("u_claire", "linkedin");

beforeEach(() => {
  table.reply = { data: null, error: null };
  table.queries = 0;
  // Base « disponible » pour ce seul module : le client Supabase est simulé ci-dessus.
  vi.stubEnv("VITEST", "");
  vi.stubEnv("SUPABASE_URL", "https://projet.supabase.invalid");
  vi.stubEnv("APP_USER_CONNECTION_KEY_SECRET", Buffer.alloc(32, 7).toString("base64"));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("F5 — getConnectionKeyForUser distingue « aucune connexion » d'une lecture impossible", () => {
  it("aucune ligne : null", async () => {
    expect(await read()).toBeNull();
    expect(table.queries).toBe(1);
  });

  it("ligne lisible : clé déchiffrée", async () => {
    table.reply = {
      data: { connection_key_ciphertext: encryptConnectionKey("lovack_cle_de_test") },
      error: null,
    };
    expect(await read()).toBe("lovack_cle_de_test");
  });

  it("erreur de la base : ConnectionKeyUnavailableError (503 linkedin_unavailable)", async () => {
    table.reply = { data: null, error: { message: "connection terminated", code: "08006" } };
    const error = await read().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectionKeyUnavailableError);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({
      status: 503,
      code: "linkedin_unavailable",
      message: "Impossible de lire votre connexion LinkedIn pour le moment : réessayez plus tard.",
    });
    expect(console.error).toHaveBeenCalled();
  });

  it("chiffré illisible (secret changé, ligne corrompue) : erreur, jamais null", async () => {
    table.reply = {
      data: { connection_key_ciphertext: Buffer.alloc(40, 1).toString("base64") },
      error: null,
    };
    await expect(read()).rejects.toBeInstanceOf(ConnectionKeyUnavailableError);
  });

  it("secret de chiffrement absent : erreur, jamais null", async () => {
    table.reply = {
      data: { connection_key_ciphertext: encryptConnectionKey("lovack_cle_de_test") },
      error: null,
    };
    vi.stubEnv("APP_USER_CONNECTION_KEY_SECRET", "");
    await expect(read()).rejects.toBeInstanceOf(ConnectionKeyUnavailableError);
  });

  it("hors base (Vitest, dev local) : null sans requête", async () => {
    vi.stubEnv("VITEST", "true");
    expect(await read()).toBeNull();
    expect(table.queries).toBe(0);
  });
});
