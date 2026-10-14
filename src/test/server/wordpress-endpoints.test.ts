import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ApiErrorBody,
  Article,
  ArticleDetail,
  AuditEvent,
  Dashboard,
  PublicationAttempt,
  WordPressCategory,
  WordPressCheck,
  WordPressStatus,
} from "@/lib/api/types";
import { resetAdapters } from "@/server/adapters";
import { SIMULATED_CATEGORIES } from "@/server/adapters/channels";
import { CATEGORY_LABEL } from "@/server/store/catalog";
import type { Repository } from "@/server/store/repository";
import { resolveCategories } from "@/server/wordpress/taxonomy";
import { call, resetAuthSeams, setup, teardown, useFakeSupabaseAuth, USERS } from "./helpers";
import {
  jsonResponse,
  leaksSecret,
  useFakeWordPress,
  WP_PASSWORD,
  WP_PASSWORD_COMPACT,
  WP_SITE,
  WP_TOKEN,
  WP_USERNAME,
} from "./wordpress-fake";

const { admin: ADMIN, redacteur: EDITOR, validateur: VALIDATOR, lecteur: READER } = USERS;

let repo: Repository;
let wp: ReturnType<typeof useFakeWordPress>;

beforeEach(() => {
  repo = setup();
  wp = useFakeWordPress();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  teardown();
});

async function publishedDraft(): Promise<ArticleDetail> {
  const created = await call<ArticleDetail>("POST", "/articles", {
    body: { signalId: "sig_verkor" },
    user: EDITOR,
  });
  await call("POST", `/articles/${created.body.id}/submit`, { user: EDITOR });
  await call("POST", `/articles/${created.body.id}/approve`, {
    body: { channel: "wordpress", version: 1 },
    user: VALIDATOR,
  });
  return created.body;
}

const publish = (id: string) =>
  call<PublicationAttempt & ApiErrorBody>("POST", `/articles/${id}/publish`, {
    body: { channel: "wordpress" },
    user: VALIDATOR,
  });

const refresh = (id: string, user: string = VALIDATOR) =>
  call<ArticleDetail & ApiErrorBody>("POST", `/articles/${id}/wordpress/refresh`, { user });

const saveSettings = (body: unknown, user: string | undefined = ADMIN) =>
  call<WordPressStatus & ApiErrorBody>("PUT", "/wordpress/settings", {
    body,
    ...(user ? { user } : {}),
  });

const unconfigured = () => {
  vi.stubEnv("WORDPRESS_URL", WP_SITE);
  resetAdapters();
};

describe("GET /wordpress", () => {
  it("mode réel : site, réglages par défaut et catégories KORA, sans aucun appel au site", async () => {
    const res = await call<WordPressStatus>("GET", "/wordpress", { user: READER });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      mode: "reel",
      site: WP_SITE,
      missing: [],
      settings: { categoryMap: {}, defaultCategory: null },
      koraCategories: Object.values(CATEGORY_LABEL),
    });
    expect(wp.server.requests).toHaveLength(0);
    expect(leaksSecret(res.text)).toBe(false);
    expect(res.text).not.toContain(WP_USERNAME);
  });

  it("authentification requise (mode Supabase, sans jeton)", async () => {
    useFakeSupabaseAuth();
    try {
      for (const path of ["/wordpress", "/wordpress/check", "/wordpress/categories"]) {
        expect((await call("GET", path)).status, path).toBe(401);
      }
      expect((await saveSettings({ categoryMap: {} }, undefined)).status).toBe(401);
    } finally {
      resetAuthSeams();
    }
    expect(wp.server.requests).toHaveLength(0);
  });

  it("non configuré : noms des variables manquantes, jamais leurs valeurs", async () => {
    vi.stubEnv("WORDPRESS_URL", WP_SITE);
    vi.stubEnv("WORDPRESS_APP_PASSWORD", WP_PASSWORD);
    resetAdapters();
    const res = await call<WordPressStatus>("GET", "/wordpress", { user: READER });
    expect(res.body).toMatchObject({
      mode: "non_configure",
      site: null,
      missing: ["WORDPRESS_USERNAME"],
    });
    expect(res.text).not.toContain(WP_SITE);
    expect(leaksSecret(res.text)).toBe(false);
  });

  it("simulé (tests, démonstration) : ni site ni variable manquante", async () => {
    resetAdapters();
    const res = await call<WordPressStatus>("GET", "/wordpress", { user: READER });
    expect(res.body).toMatchObject({ mode: "simule", site: null, missing: [] });
  });
});

describe("GET /wordpress/check", () => {
  it("compte Contributeur : ok, rôles, pas de droit de publier", async () => {
    const res = await call<WordPressCheck>("GET", "/wordpress/check", { user: ADMIN });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      account: { id: 7, name: "KORA Rédaction", roles: ["contributor"] },
      canPublish: false,
      error: null,
    });
  });

  it("compte trop puissant : canPublish signalé", async () => {
    wp.server.me.roles = ["editor"];
    wp.server.me.capabilities["publish_posts"] = true;
    const res = await call<WordPressCheck>("GET", "/wordpress/check", { user: ADMIN });
    expect(res.body).toMatchObject({ ok: true, canPublish: true });
  });

  it("échec : toujours 200, erreur exploitable dans `error`", async () => {
    wp.server.fail(
      () => true,
      jsonResponse({ code: "incorrect_password", message: "Mot de passe incorrect." }, 401),
    );
    const res = await call<WordPressCheck>("GET", "/wordpress/check", { user: ADMIN });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: false,
      account: null,
      canPublish: null,
      error: { code: "wordpress_auth_failed" },
    });
    expect(res.body.error!.message).toContain("WORDPRESS_APP_PASSWORD");
  });

  it("non configuré : 200, ok:false, wordpress_not_configured", async () => {
    unconfigured();
    const res = await call<WordPressCheck>("GET", "/wordpress/check", { user: ADMIN });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: false, error: { code: "wordpress_not_configured" } });
  });

  it("réservé aux administrateurs", async () => {
    for (const user of [VALIDATOR, EDITOR, READER]) {
      expect((await call("GET", "/wordpress/check", { user })).status).toBe(403);
    }
    expect(wp.server.requests).toHaveLength(0);
  });
});

describe("GET /wordpress/categories", () => {
  it("toutes les catégories du site, noms décodés", async () => {
    const res = await call<WordPressCategory[]>("GET", "/wordpress/categories", { user: ADMIN });
    expect(res.status).toBe(200);
    expect(res.body.find((c) => c.id === 13)).toEqual({
      id: 13,
      name: "Distinction & prix",
      slug: "distinction-prix",
      parent: 0,
    });
    expect(res.body).toHaveLength(wp.server.categories.length);
  });

  it("simulé : la liste fictive ; non configuré : 503 ; non-administrateur : 403", async () => {
    expect((await call("GET", "/wordpress/categories", { user: VALIDATOR })).status).toBe(403);
    resetAdapters();
    const simulated = await call<WordPressCategory[]>("GET", "/wordpress/categories", {
      user: ADMIN,
    });
    expect(simulated.body).toEqual(SIMULATED_CATEGORIES);
    unconfigured();
    const missing = await call<ApiErrorBody>("GET", "/wordpress/categories", { user: ADMIN });
    expect(missing.status).toBe(503);
    expect(missing.body.error.code).toBe("wordpress_not_configured");
  });
});

describe("PUT /wordpress/settings", () => {
  it("enregistre la correspondance (libellés normalisés, valeurs vides retirées) et l'audite", async () => {
    const res = await saveSettings({
      categoryMap: {
        "levée de fonds": "financement",
        Innovation: "",
        "Distinction & prix": "%c3%a9conomie",
        Recherche: null,
        Brevet: "propriete_intellectuelle",
      },
      defaultCategory: "",
    });
    expect(res.status).toBe(200);
    expect(res.body.settings).toEqual({
      categoryMap: {
        "Levée de fonds": "financement",
        "Distinction & prix": "%c3%a9conomie",
        Brevet: "propriete_intellectuelle",
      },
      defaultCategory: null,
    });
    const status = await call<WordPressStatus>("GET", "/wordpress", { user: READER });
    expect(status.body.settings).toEqual(res.body.settings);
    const audit = await call<AuditEvent[]>("GET", "/audit?limit=1");
    expect(audit.body[0]).toMatchObject({ action: "wordpress.settings", actor: "Sophie Martin" });
    expect(audit.body[0]!.details).toContain("Levée de fonds → financement");
  });

  it.each([
    [{ categoryMap: { Sport: "sport" } }, "Catégorie KORA inconnue"],
    [{ categoryMap: { Innovation: "Innovation" } }, "Slug WordPress attendu"],
    [{ categoryMap: { Innovation: "%C3%A9conomie" } }, "Slug WordPress attendu"],
    [{ categoryMap: { Innovation: "a b" } }, "Slug WordPress attendu"],
    [{ categoryMap: { Innovation: "a.b" } }, "Slug WordPress attendu"],
    [{ categoryMap: { Innovation: "a".repeat(201) } }, "trop long"],
    [{ categoryMap: {}, defaultCategory: "Défaut" }, "Slug WordPress attendu"],
    [{ categoryMap: [] }, ""],
    [{}, ""],
  ])("refuse %j", async (body, message) => {
    const res = await saveSettings(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
    expect(res.body.error.message).toContain(message);
  });

  it("réservé aux administrateurs, en-tête anti-CSRF exigé", async () => {
    const res = await saveSettings({ categoryMap: {}, defaultCategory: null }, VALIDATOR);
    expect(res.status).toBe(403);
    const noCsrf = await call<ApiErrorBody>("PUT", "/wordpress/settings", {
      body: { categoryMap: { Brevet: "brevets" }, defaultCategory: null },
      user: ADMIN,
      csrf: false,
    });
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.error.code).toBe("csrf_header_missing");
    expect(await repo.getWordPressSettings()).toEqual({
      categoryMap: {},
      defaultCategory: null,
    });
  });

  it("appliqué à l'envoi : correspondance, slug inconnu cité, catégorie par défaut", async () => {
    await saveSettings({ categoryMap: { partenariat: "financement" }, defaultCategory: null });
    const art = await publishedDraft();
    const first = await publish(art.id);
    expect(wp.server.writes()[0]!.body).toMatchObject({ categories: [11] });
    expect(first.body.message).not.toContain("Aucune catégorie correspondante");

    await saveSettings({ categoryMap: { Partenariat: "disparue" }, defaultCategory: "actualites" });
    const edited = await call<ArticleDetail>("POST", `/articles/${art.id}/versions`, {
      body: { title: art.title, chapo: "Chapô relu.", body: "Corps relu." },
      user: EDITOR,
    });
    expect(edited.body.versions.at(-1)!.categories).toEqual(["Partenariat"]);
    await call("POST", `/articles/${art.id}/approve`, {
      body: { channel: "wordpress", version: 2 },
      user: VALIDATOR,
    });
    const res = await publish(art.id);
    expect(res.status).toBe(201);
    expect(wp.server.writes()[1]!.body).toMatchObject({ categories: [15] });
    expect(res.body.message).toContain("introuvable(s) sur le site, ignorée(s) : disparue.");
    expect(res.body.message).toContain("Catégorie par défaut appliquée (actualites).");
  });

  it("sans réglage : même slug que la catégorie KORA", async () => {
    wp.server.categories.push({ id: 17, name: "Partenariats industriels", slug: "partenariat" });
    const art = await publishedDraft();
    await publish(art.id);
    expect(wp.server.writes()[0]!.body).toMatchObject({ categories: [17] });
  });
});

describe("resolveCategories", () => {
  const available = [
    { id: 13, name: "Distinction & prix", slug: "distinction-prix", parent: 0 },
    { id: 16, name: "Économie", slug: "%c3%a9conomie", parent: 0 },
    { id: 18, name: "Recherche", slug: "recherche-academique", parent: 0 },
  ];

  it("nom identique (entités et casse comprises), slug encodé, correspondance prioritaire", () => {
    expect(
      resolveCategories(
        ["distinction &amp; PRIX", "Recherche"],
        { categoryMap: { recherche: "%C3%A9conomie" }, defaultCategory: null },
        available,
      ),
    ).toEqual({ ids: [13, 16], defaultSlug: null, none: false, unknownSlugs: [] });
  });

  it("aucune correspondance ni défaut : aucune catégorie", () => {
    expect(
      resolveCategories(["Brevet"], { categoryMap: {}, defaultCategory: "absente" }, available),
    ).toEqual({ ids: [], defaultSlug: null, none: true, unknownSlugs: ["absente"] });
  });
});

describe("POST /articles/:id/wordpress/refresh", () => {
  it.each([
    ["draft", "brouillon"],
    ["pending", "en_attente"],
    ["future", "programme"],
    ["trash", "supprime"],
  ] as const)("statut WordPress %s → %s", async (remote, local) => {
    const art = await publishedDraft();
    await publish(art.id);
    wp.server.posts.get(100)!.status = remote;
    const res = await refresh(art.id);
    expect(res.status).toBe(200);
    expect(res.body.wordpress).toMatchObject({ remoteId: "100", status: local });
    expect(res.body.status).toBe("approuve");
    expect(res.body.versions).toHaveLength(1);
    expect(wp.server.writes()).toHaveLength(1);
  });

  it.each(["publish", "private"])(
    "statut WordPress %s : l'article passe publié à la date WordPress",
    async (remote) => {
      const art = await publishedDraft();
      await publish(art.id);
      Object.assign(wp.server.posts.get(100)!, { status: remote, date_gmt: "2026-10-12T09:45:00" });
      const res = await refresh(art.id);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("publie");
      expect(res.body.wordpress).toMatchObject({ status: "publie", editUrl: expect.any(String) });
      expect((await repo.articles.get(art.id))!.publishedAt).toBe("2026-10-12T09:45:00.000Z");
      const audit = await call<AuditEvent[]>("GET", "/audit?limit=1");
      expect(audit.body[0]).toMatchObject({ action: "wordpress.sync", entity: "article" });
      expect(audit.body[0]!.details).toBe(
        "Brouillon WordPress n° 100 : brouillon → publié (article publié)",
      );
    },
  );

  it("supprimé définitivement : supprime, et le même envoi crée alors un nouveau brouillon", async () => {
    const art = await publishedDraft();
    await publish(art.id);
    wp.server.posts.delete(100);
    expect((await refresh(art.id)).body.wordpress.status).toBe("supprime");
    const again = await publish(art.id);
    expect(again.status).toBe(201);
    expect(again.body.remoteId).toBe("101");
    expect((await refresh(art.id)).body.wordpress).toMatchObject({
      remoteId: "101",
      status: "brouillon",
    });
  });

  it("lien « supprimé » relu : un brouillon restauré redevient « brouillon » ; 404 passager sans effet", async () => {
    const art = await publishedDraft();
    await publish(art.id);
    const saved = { ...wp.server.posts.get(100)! };
    wp.server.posts.delete(100);
    expect((await refresh(art.id)).body.wordpress.status).toBe("supprime");
    wp.server.posts.set(100, saved);
    const restored = await refresh(art.id);
    expect(restored.status).toBe(200);
    expect(restored.body.wordpress).toMatchObject({ remoteId: "100", status: "brouillon" });

    wp.server.fail(() => true, jsonResponse({ code: "rest_no_route" }, 404));
    const transient = await refresh(art.id);
    expect(transient.status).toBe(502);
    expect(transient.body.error.code).toBe("wordpress_invalid");
    expect((await repo.articles.get(art.id))!.wordpress.status).toBe("brouillon");
  });

  it("le tableau de bord compte les brouillons en attente de relecture", async () => {
    const kpi = async () =>
      (await call<Dashboard>("GET", "/dashboard")).body.kpis.find(
        (k) => k.key === "wordpress_drafts",
      )!.value;
    const before = await kpi();
    const art = await publishedDraft();
    await publish(art.id);
    wp.server.posts.get(100)!.status = "pending";
    await refresh(art.id);
    expect(await kpi()).toBe(before + 1);
    wp.server.posts.delete(100);
    await refresh(art.id);
    expect(await kpi()).toBe(before);
  });

  it("sans brouillon valide (aucun, simulé) : 409 wordpress_no_draft, aucun appel", async () => {
    const art = await publishedDraft();
    for (const id of [art.id, "art_pasqal"]) {
      const res = await refresh(id);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("wordpress_no_draft");
    }
    expect(wp.server.requests).toHaveLength(0);
    expect((await refresh("art_inconnu")).status).toBe(404);
  });

  it("mode réel : lien d'édition nul exactement quand l'actualisation est refusée", async () => {
    const own = await publishedDraft();
    await publish(own.id);
    const unlinked = (await repo.articles.list()).filter((a) => a.wordpress.remoteId === null);
    expect(unlinked.length).toBeGreaterThanOrEqual(2);
    for (const [rec, site] of [
      [unlinked[0]!, "https://preprod.example.test"],
      [unlinked[1]!, undefined],
    ] as const) {
      await repo.articles.update({
        ...rec,
        wordpress: {
          remoteId: "100",
          ...(site ? { site } : {}),
          status: "brouillon",
          lastSyncAt: rec.updatedAt,
        },
      });
    }

    const list = await call<Article[]>("GET", "/articles", { user: VALIDATOR });
    const linked = list.body.filter((a) => a.wordpress.remoteId !== null);
    expect(linked.some((a) => a.wordpress.remoteId!.startsWith("wp-"))).toBe(true);
    for (const article of linked) {
      const calls = wp.server.requests.length;
      const res = await refresh(article.id);
      if (article.id === own.id) {
        expect(article.wordpress.editUrl).toBe(`${WP_SITE}/wp-admin/post.php?post=100&action=edit`);
        expect(res.status).toBe(200);
      } else {
        expect(article.wordpress.editUrl).toBeNull();
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe("wordpress_no_draft");
        expect(wp.server.requests).toHaveLength(calls);
      }
    }
  });

  it("erreur du site : 502, article inchangé", async () => {
    const art = await publishedDraft();
    await publish(art.id);
    const before = await repo.articles.get(art.id);
    wp.server.fail(() => true, jsonResponse({ code: "x" }, 500));
    const res = await refresh(art.id);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("wordpress_unavailable");
    expect(await repo.articles.get(art.id)).toEqual(before);
  });

  it("droit publish requis ; non configuré : 503", async () => {
    const art = await publishedDraft();
    await publish(art.id);
    for (const user of [READER, EDITOR]) expect((await refresh(art.id, user)).status).toBe(403);
    unconfigured();
    const res = await refresh(art.id);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("wordpress_not_configured");
  });
});

describe("secret WordPress", () => {
  it("le mot de passe n'apparaît dans aucune réponse, journal, audit, tentative ni export", async () => {
    const consoleLines: string[] = [];
    for (const method of ["error", "warn", "log", "info"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        consoleLines.push(args.map((a) => (a instanceof Error ? a.stack : String(a))).join(" "));
      });
    }
    vi.stubEnv("WORDPRESS_URL", WP_SITE);
    vi.stubEnv("WORDPRESS_USERNAME", WP_USERNAME);
    vi.stubEnv("WORDPRESS_APP_PASSWORD", WP_PASSWORD);
    const echo = `refusé pour ${WP_PASSWORD_COMPACT} (Basic ${WP_TOKEN})`;
    const texts: string[] = [];
    const record = async (p: Promise<{ text: string }>) => texts.push((await p).text);

    const art = await publishedDraft();
    await record(call("GET", "/wordpress", { user: ADMIN }));
    await record(call("GET", "/wordpress/check", { user: ADMIN }));
    await record(call("GET", "/wordpress/categories", { user: ADMIN }));
    wp.server.fail((r) => r.method === "POST", jsonResponse({ code: "x", message: echo }, 400));
    await record(publish(art.id));
    wp.server.fail((r) => r.method === "POST", jsonResponse({ code: "x", message: echo }, 500));
    await record(publish(art.id));
    await record(publish(art.id));
    wp.server.fail(() => true, jsonResponse({ code: "x", message: echo }, 401));
    await record(call("GET", "/wordpress/check", { user: ADMIN }));
    wp.server.fail(() => true, new Response(echo, { status: 503 }));
    await record(refresh(art.id));
    await record(refresh(art.id));
    await record(call("GET", `/articles/${art.id}`, { user: ADMIN }));
    await record(call("GET", "/articles", { user: ADMIN }));
    await record(call("GET", `/publications?articleId=${art.id}`, { user: ADMIN }));
    await record(call("GET", "/audit?limit=1000", { user: ADMIN }));
    await record(call("GET", "/notifications", { user: ADMIN }));
    await record(call("GET", "/dashboard", { user: ADMIN }));
    const manifest = await call("GET", "/export/manifest", { user: ADMIN });
    texts.push(manifest.text);
    const { entities } = JSON.parse(manifest.text) as { entities: { json: string }[] };
    expect(entities.length).toBeGreaterThan(0);
    for (const { json } of entities) {
      await record(call("GET", json.replace(/^\/api/, ""), { user: ADMIN }));
    }

    // Les réponses du site renvoyant le secret ont bien été vues (sinon le test ne prouve rien).
    expect(texts.join("\n")).toContain("[masqué]");
    const stored = JSON.stringify([
      await repo.publications.list(),
      await repo.audit.list(),
      await repo.articles.list(),
      await repo.getSettings(),
    ]);
    for (const text of [...texts, ...wp.logs, ...consoleLines, stored]) {
      expect(leaksSecret(text), text.slice(0, 300)).toBe(false);
    }
  });
});
