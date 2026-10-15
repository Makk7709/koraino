import { afterEach, describe, expect, it, vi } from "vitest";
import { adapters, resetAdapters } from "@/server/adapters";
import { SimulatedWordPress } from "@/server/adapters/channels";
import {
  createWordPressClient,
  RestWordPress,
  UnconfiguredWordPress,
} from "@/server/wordpress/client";
import { normalizeSiteUrl, readWordPressConfig } from "@/server/wordpress/config";
import { WordPressError } from "@/server/wordpress/errors";
import { WP_PASSWORD, WP_PASSWORD_COMPACT, WP_SITE, WP_USERNAME } from "./wordpress-fake";

function stubWordPress(env: { url?: string; username?: string; password?: string }) {
  vi.stubEnv("WORDPRESS_URL", env.url ?? "");
  vi.stubEnv("WORDPRESS_USERNAME", env.username ?? "");
  vi.stubEnv("WORDPRESS_APP_PASSWORD", env.password ?? "");
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetAdapters();
});

describe("mode WordPress selon l'environnement", () => {
  it("sous Vitest sans variable : simulé (adaptateur par défaut compris)", () => {
    stubWordPress({});
    expect(readWordPressConfig()).toMatchObject({ mode: "simule", missing: [] });
    resetAdapters();
    expect(adapters().wordpress).toBeInstanceOf(SimulatedWordPress);
    expect(adapters().wordpress.mode).toBe("simule");
  });

  it("production sans variable : non configuré, jamais simulé", () => {
    stubWordPress({});
    vi.stubEnv("VITEST", "");
    vi.stubEnv("SUPABASE_URL", "https://projet.supabase.example.test");
    const config = readWordPressConfig();
    expect(config).toMatchObject({
      mode: "non_configure",
      missing: ["WORDPRESS_URL", "WORDPRESS_USERNAME", "WORDPRESS_APP_PASSWORD"],
    });
    expect(createWordPressClient(config)).toBeInstanceOf(UnconfiguredWordPress);
  });

  it("démonstration locale (SUPABASE_URL vide) sans variable : simulé", () => {
    stubWordPress({});
    vi.stubEnv("VITEST", "");
    vi.stubEnv("SUPABASE_URL", "");
    expect(readWordPressConfig().mode).toBe("simule");
  });

  it("configuration partielle : non configuré, même sous Vitest, avec les seuls noms manquants", () => {
    stubWordPress({ url: WP_SITE, password: WP_PASSWORD });
    const config = readWordPressConfig();
    expect(config).toMatchObject({ mode: "non_configure", missing: ["WORDPRESS_USERNAME"] });
    expect(JSON.stringify(config)).not.toContain(WP_PASSWORD_COMPACT);
  });

  it("adresse refusée (http public, identifiants dans l'URL) : WORDPRESS_URL invalide", async () => {
    stubWordPress({ url: "http://wp.example.test", username: WP_USERNAME, password: WP_PASSWORD });
    const config = readWordPressConfig();
    expect(config).toMatchObject({
      mode: "non_configure",
      missing: ["WORDPRESS_URL"],
      invalidUrl: true,
    });
    const client = createWordPressClient(config);
    const error = await client.whoAmI().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WordPressError);
    expect(error).toMatchObject({ status: 503, code: "wordpress_not_configured" });
    expect((error as Error).message).toContain("WORDPRESS_URL");
    expect((error as Error).message).toContain("https");
  });

  it("configuration complète : client réel, mot de passe sans espaces, lu à chaque appel", () => {
    stubWordPress({ url: `${WP_SITE}/`, username: ` ${WP_USERNAME} `, password: WP_PASSWORD });
    const config = readWordPressConfig();
    expect(config).toMatchObject({
      mode: "reel",
      credentials: { site: WP_SITE, username: WP_USERNAME, appPassword: WP_PASSWORD_COMPACT },
    });
    const client = createWordPressClient(config);
    expect(client).toBeInstanceOf(RestWordPress);
    expect(client.site).toBe(WP_SITE);
    // Champs privés natifs : rien du secret dans une sérialisation ou un affichage.
    expect(JSON.stringify(client)).not.toContain(WP_PASSWORD_COMPACT);
    expect(JSON.stringify(client)).not.toContain("Basic");

    stubWordPress({});
    expect(readWordPressConfig().mode).toBe("simule");
  });

  it("chaque message d'erreur cite les variables, jamais leur valeur", async () => {
    stubWordPress({ url: WP_SITE, username: WP_USERNAME });
    const client = createWordPressClient();
    const error = (await client.listCategories().catch((e: unknown) => e)) as WordPressError;
    expect(error.code).toBe("wordpress_not_configured");
    expect(error.message).toContain("WORDPRESS_APP_PASSWORD");
    expect(error.message).not.toContain(WP_SITE);
    expect(error.message).not.toContain(WP_USERNAME);
  });
});

describe("normalizeSiteUrl", () => {
  it.each([
    [" https://wp.example.test/ ", "https://wp.example.test"],
    ["https://wp.example.test/actualites//", "https://wp.example.test/actualites"],
    ["HTTPS://WP.Example.test", "https://wp.example.test"],
    ["http://localhost:8080", "http://localhost:8080"],
    ["http://127.0.0.1/wp", "http://127.0.0.1/wp"],
  ])("accepte %s", (raw, expected) => {
    expect(normalizeSiteUrl(raw)).toBe(expected);
  });

  it.each([
    "http://wp.example.test",
    "ftp://wp.example.test",
    "https://user:secret@wp.example.test",
    "https://wp.example.test/?page=1",
    "https://wp.example.test/#ancre",
    "wp.example.test",
    "",
  ])("refuse %s", (raw) => {
    expect(normalizeSiteUrl(raw)).toBeNull();
  });
});
