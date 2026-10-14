import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setClock } from "@/server/clock";
import { RestWordPress, WORDPRESS_USER_AGENT } from "@/server/wordpress/client";
import { WordPressError } from "@/server/wordpress/errors";
import { NOW } from "./helpers";
import {
  fakeWordPress,
  htmlResponse,
  jsonResponse,
  KORA_ACCOUNT,
  leaksSecret,
  OTHER_ACCOUNT,
  WP_PASSWORD,
  WP_PASSWORD_COMPACT,
  WP_SITE,
  WP_TOKEN,
  WP_USERNAME,
  type Recorded,
} from "./wordpress-fake";

beforeEach(() => setClock(() => NOW));
afterEach(() => setClock(null));

const draft = {
  title: "Verkor & Renault : 2 Md€ pour la gigafactory",
  content: "<p>Corps</p>",
  excerpt: "Extrait",
  categories: [12],
  tags: [21],
};

async function failure(promise: Promise<unknown>): Promise<WordPressError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(WordPressError);
  return error as WordPressError;
}

const isWrite = (r: Recorded) => r.method === "POST";

describe("RestWordPress : requêtes envoyées", () => {
  it("authentification Basic, en-têtes, redirections non suivies, délai borné", async () => {
    const { client, server } = fakeWordPress();
    const account = await client.whoAmI();
    expect(account).toEqual({
      id: KORA_ACCOUNT,
      name: "KORA Rédaction",
      roles: ["contributor"],
      canPublish: false,
    });
    const [req] = server.requests;
    expect(req!.url.href).toBe(`${WP_SITE}/wp-json/wp/v2/users/me?context=edit`);
    expect(req!.headers.get("authorization")).toBe(`Basic ${WP_TOKEN}`);
    expect(req!.headers.get("accept")).toBe("application/json");
    expect(req!.headers.get("user-agent")).toBe(WORDPRESS_USER_AGENT);
    expect(req!.redirect).toBe("manual");
    expect(req!.signal).toBeInstanceOf(AbortSignal);
  });

  it("compte en mémoire : servi si assez récent, relu sinon (et toujours sans maxAgeMs)", async () => {
    const { client, server } = fakeWordPress();
    await client.whoAmI();
    server.me.capabilities["publish_posts"] = true;
    expect((await client.whoAmI({ maxAgeMs: 60_000 })).canPublish).toBe(false);
    expect(server.requests).toHaveLength(1);
    setClock(() => new Date(NOW.getTime() + 60_001));
    expect((await client.whoAmI({ maxAgeMs: 60_000 })).canPublish).toBe(true);
    server.me.capabilities["publish_posts"] = false;
    expect((await client.whoAmI()).canPublish).toBe(false);
    expect(server.requests).toHaveLength(3);
  });

  it("crée et met à jour toujours en brouillon, sans liste vide", async () => {
    const { client, server } = fakeWordPress();
    const created = await client.createDraft(draft);
    expect(created).toMatchObject({
      id: "100",
      status: "draft",
      title: draft.title,
      authorId: KORA_ACCOUNT,
      // Dates `*_gmt` sans fuseau côté WordPress, brouillon sans date fixée.
      dateGmt: null,
      modifiedGmt: NOW.toISOString(),
    });
    expect(server.posts.get(100)!.title).toBe("Verkor &amp; Renault : 2 Md€ pour la gigafactory");
    const updated = await client.updateDraft("100", { ...draft, categories: [], tags: [] });
    expect(updated.id).toBe("100");

    const [create, update] = server.writes();
    expect(create!.url.pathname).toBe("/wp-json/wp/v2/posts");
    expect(create!.body).toEqual({ ...draft, status: "draft" });
    expect(update!.url.pathname).toBe("/wp-json/wp/v2/posts/100");
    expect(update!.body).toEqual({
      title: draft.title,
      content: draft.content,
      excerpt: draft.excerpt,
      status: "draft",
    });
    expect(server.writes().every((r) => r.body?.["status"] === "draft")).toBe(true);
  });

  it("refuse un identifiant non numérique sans appeler le site", async () => {
    const { client, server } = fakeWordPress();
    expect((await failure(client.updateDraft("wp-4821", draft))).code).toBe("wordpress_invalid");
    expect(await client.getPost("wp-4821")).toBeNull();
    expect(server.requests).toHaveLength(0);
  });

  it("lit toutes les pages de catégories et décode les noms", async () => {
    const { client, server } = fakeWordPress();
    for (let i = 0; i < 230; i++) {
      server.categories.push({
        id: 1000 + i,
        name: `Rubrique ${i} &amp; co`,
        slug: `rubrique-${i}`,
      });
    }
    const list = await client.listCategories();
    expect(list).toHaveLength(236);
    expect(list.find((c) => c.id === 13)).toEqual({
      id: 13,
      name: "Distinction & prix",
      slug: "distinction-prix",
      parent: 0,
    });
    expect(list.at(-1)!.name).toBe("Rubrique 229 & co");
    const pages = server.requests.map((r) => r.url.searchParams.get("page"));
    expect(pages).toEqual(["1", "2", "3"]);
    expect(server.requests[0]!.url.searchParams.get("per_page")).toBe("100");
    expect(server.requests[0]!.url.searchParams.get("_fields")).toBe("id,name,slug,parent");
  });

  it("étiquettes : correspondance exacte (entités, casse), les autres sont signalées", async () => {
    const { client } = fakeWordPress();
    const tags = await client.findTags(["isère", "R&D", "Batterie", "batteries", "ISÈRE", ""]);
    expect(tags).toEqual({ ids: [21, 22, 23], missing: ["Batterie"] });
  });

  it("étiquettes au-delà de la première page : slug exact, puis recherche paginée bornée", async () => {
    const { client, server } = fakeWordPress();
    // La recherche WordPress est un « contient » trié par nom : 150 étiquettes passent avant.
    for (let i = 0; i < 150; i++) {
      server.tags.push({ id: 3000 + i, name: `Aia ${i}`, slug: `aia-${i}` });
      server.tags.push({ id: 4000 + i, name: `Blyon ${i}`, slug: `blyon-${i}` });
    }
    server.tags.push({ id: 31, name: "IA", slug: "ia" });
    // Slug différent du calcul (« lyon-2 ») : retrouvée par la recherche, en page 2.
    server.tags.push({ id: 32, name: "Lyon", slug: "lyon-2" });
    const tags = await client.findTags(["IA", "Lyon", "Inconnue"]);
    expect(tags).toEqual({ ids: [31, 32], missing: ["Inconnue"] });

    const lookups = server.requests.map((r) => r.url.searchParams);
    expect(lookups[0]!.get("slug")).toBe("ia,lyon,inconnue");
    const lyon = lookups.filter((q) => q.get("search") === "Lyon").map((q) => q.get("page"));
    expect(lyon).toEqual(["1", "2"]);
    expect(lookups.filter((q) => q.get("search") === "IA")).toHaveLength(0);
  });

  it("recherche d'étiquette limitée à 3 pages", async () => {
    const { client, server } = fakeWordPress();
    for (let i = 0; i < 400; i++) {
      server.tags.push({ id: 5000 + i, name: `Alpha nova ${i}`, slug: `alpha-nova-${i}` });
    }
    server.tags.push({ id: 33, name: "Nova", slug: "nova-x" });
    expect(await client.findTags(["Nova"])).toEqual({ ids: [], missing: ["Nova"] });
    const pages = server.requests.filter((r) => r.url.searchParams.get("search") === "Nova");
    expect(pages.map((r) => r.url.searchParams.get("page"))).toEqual(["1", "2", "3"]);
  });

  it("retrouve ses brouillons par jeton, dans la fenêtre de dates, en excluant ceux des autres", async () => {
    const { client, server } = fakeWordPress();
    const token = "kora:article=art_n1";
    const content = `<p>Texte</p>\n<!-- ${token} -->`;
    const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();
    // Dates `*_gmt` de WordPress : sans fuseau.
    const wpAt = (minutes: number) => at(minutes).slice(0, 19);
    const mine = server.addPost({ content });
    server.addPost({ content, author: OTHER_ACCOUNT });
    server.addPost({ content: "<p>Sans jeton</p>" });
    server.addPost({ content, modified_gmt: wpAt(-60) });
    server.addPost({ content, modified_gmt: wpAt(30) });
    server.addPost({ content, status: "publish" });
    const found = await client.findOwnDrafts(token, at(-2), at(10));
    expect(found.map((p) => p.id)).toEqual([String(mine.id)]);
    expect(found[0]!.content).toBe(content);
    const search = server.requests.find((r) => r.url.pathname.endsWith("/posts"))!.url.searchParams;
    expect(search.get("author")).toBe(String(KORA_ACCOUNT));
    expect(search.get("status")).toBe("draft,pending");
    expect(search.get("context")).toBe("edit");
    expect(search.get("search")).toBe(token);
  });

  it("contenu publié : illisible en édition pour un Contributeur, relu en lecture publique", async () => {
    const { client, server } = fakeWordPress();
    const post = server.addPost({ status: "publish", title: "Article en ligne" });
    expect(await client.getPost(String(post.id))).toMatchObject({
      status: "publish",
      title: "Article en ligne",
    });
    const contexts = server.requests.map((r) => r.url.searchParams.get("context"));
    expect(contexts).toEqual(["edit", null]);
    expect(await client.getPost("999")).toBeNull();
  });

  it("absent seulement sur 410 ou 404 rest_post_invalid_id ; tout autre 404 est une erreur", async () => {
    const { client, server } = fakeWordPress();
    const post = server.addPost();
    const id = String(post.id);
    server.fail(() => true, jsonResponse({ code: "rest_no_route", message: "Aucune route." }, 404));
    const filtered = await failure(client.getPost(id));
    expect(filtered.code).toBe("wordpress_invalid");
    expect(filtered.message).toContain("sans indiquer qu'il a été supprimé (HTTP 404 rest_no_route)");
    server.fail(() => true, new Response("", { status: 404 }));
    expect((await failure(client.getPost(id))).code).toBe("wordpress_invalid");
    server.fail(() => true, jsonResponse({ code: "rest_gone" }, 410));
    expect(await client.getPost(id)).toBeNull();
    expect(await client.getPost("999")).toBeNull();
    expect(await client.getPost(id)).toMatchObject({ id, status: "draft" });
  });

  it("mise à jour d'un contenu en attente de relecture : le statut pending est conservé", async () => {
    const { client, server } = fakeWordPress();
    const post = server.addPost({ status: "pending" });
    const updated = await client.updateDraft(String(post.id), draft, "pending");
    expect(updated.status).toBe("pending");
    expect(server.writes()[0]!.body).toMatchObject({ status: "pending" });
    // Garde-fou : un statut public passé malgré le typage n'est jamais envoyé.
    await client.updateDraft(String(post.id), draft, "publish" as "pending");
    expect(server.writes()[1]!.body).toMatchObject({ status: "draft" });
  });

  it("réponse de plus de 2 Mo : refusée sans être lue en entier", async () => {
    const { client, server, logs } = fakeWordPress();
    // Flux sans fin ni Content-Length : seule une lecture plafonnée s'arrête.
    const endless = new ReadableStream<Uint8Array>({
      pull: (controller) => controller.enqueue(new Uint8Array(64 * 1024).fill(32)),
    });
    server.fail(
      () => true,
      new Response(endless, { headers: { "content-type": "application/json" } }),
    );
    const read = await failure(client.listCategories());
    expect(read).toMatchObject({ code: "wordpress_invalid", verifyBeforeRetry: false });
    expect(read.message).toContain("trop volumineuse (plus de 2 Mo)");

    server.fail(
      isWrite,
      new Response("{}", { status: 201, headers: { "content-length": String(50 * 1024 * 1024) } }),
    );
    const write = await failure(client.createDraft(draft));
    // Après un envoi, WordPress a peut-être enregistré le contenu : vérification avant renvoi.
    expect(write).toMatchObject({ code: "wordpress_invalid", verifyBeforeRetry: true });
    expect(logs.filter((l) => l.includes("plus de 2 Mo"))).toHaveLength(2);
  });

  it("brouillon d'un autre compte devenu illisible : wordpress_forbidden", async () => {
    const { client, server } = fakeWordPress();
    const post = server.addPost({ author: OTHER_ACCOUNT });
    expect((await failure(client.getPost(String(post.id)))).code).toBe("wordpress_forbidden");
  });

  it("statut inconnu renvoyé par WordPress : wordpress_invalid, rien n'est supposé", async () => {
    const { client, server } = fakeWordPress();
    const post = server.addPost({ status: "acf-disabled" });
    const error = await failure(client.getPost(String(post.id)));
    expect(error.code).toBe("wordpress_invalid");
    expect(error.message).toContain("acf-disabled");
  });
});

describe("RestWordPress : erreurs du site", () => {
  const cases: [string, Response | "timeout" | "network", string, number, boolean][] = [
    [
      "401 JSON",
      jsonResponse({ code: "invalid_username", message: "Identifiant inconnu." }, 401),
      "wordpress_auth_failed",
      502,
      false,
    ],
    [
      "401 HTML (protection par mot de passe)",
      htmlResponse(401),
      "wordpress_auth_failed",
      502,
      false,
    ],
    [
      "403 JSON",
      jsonResponse({ code: "rest_cannot_create", message: "Désolé&hellip;" }, 403),
      "wordpress_forbidden",
      502,
      false,
    ],
    ["403 HTML (Cloudflare)", htmlResponse(403), "wordpress_blocked", 502, false],
    ["429 HTML (Cloudflare)", htmlResponse(429), "wordpress_blocked", 502, false],
    [
      "429 JSON",
      jsonResponse({ code: "too_many" }, 429, { "retry-after": "30" }),
      "wordpress_rate_limited",
      502,
      false,
    ],
    ["503 HTML", htmlResponse(503), "wordpress_blocked", 502, true],
    ["500 JSON", jsonResponse({ code: "internal" }, 500), "wordpress_unavailable", 502, true],
    [
      "400 JSON",
      jsonResponse({ code: "rest_invalid_param" }, 400),
      "wordpress_invalid",
      502,
      false,
    ],
    ["413", new Response("", { status: 413 }), "wordpress_invalid", 502, false],
    [
      "301 (redirection)",
      new Response(null, { status: 301, headers: { location: "https://www.wp.example.test/" } }),
      "wordpress_invalid",
      502,
      false,
    ],
    ["200 HTML (pas l'API)", htmlResponse(200), "wordpress_invalid", 502, true],
    ["délai dépassé", "timeout", "wordpress_unavailable", 502, true],
    ["coupure réseau", "network", "wordpress_unavailable", 502, true],
  ];

  it.each(cases)("%s → %s", async (_label, fault, code, status, verify) => {
    const { client, server } = fakeWordPress();
    server.fail(isWrite, fault);
    const error = await failure(client.createDraft(draft));
    expect(error).toMatchObject({ code, status, verifyBeforeRetry: verify });
    expect(error.message).toMatch(/[A-Za-zÀ-ÿ]{4}/);
  });

  it("429 JSON : délai indiqué par Retry-After", async () => {
    const { client, server } = fakeWordPress();
    server.fail(() => true, jsonResponse({}, 429, { "retry-after": "30" }));
    expect((await failure(client.whoAmI())).message).toContain("dans 30 s");
  });

  it("identifiants refusés : message exploitable, réponse du site citée et décodée", async () => {
    const { server } = fakeWordPress();
    const wrong = new RestWordPress(
      { site: WP_SITE, username: WP_USERNAME, appPassword: "mauvais" },
      { fetch: server.fetch, log: () => {} },
    );
    const error = await failure(wrong.whoAmI());
    expect(error.code).toBe("wordpress_auth_failed");
    expect(error.message).toContain("WORDPRESS_APP_PASSWORD");
    expect(error.message).toContain("Le mot de passe fourni pour l’identifiant kora-redaction");
  });

  it("le délai de la requête est réellement borné par AbortSignal", async () => {
    const hanging = (_url: URL, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
      });
    const client = new RestWordPress(
      { site: WP_SITE, username: WP_USERNAME, appPassword: WP_PASSWORD_COMPACT },
      { fetch: hanging, timeoutMs: 20, log: () => {} },
    );
    const error = await failure(client.whoAmI());
    expect(error).toMatchObject({ code: "wordpress_unavailable", verifyBeforeRetry: true });
  });
});

describe("RestWordPress : secret", () => {
  it("le mot de passe n'apparaît dans aucun message ni journal, même renvoyé par le site", async () => {
    const { client, server, logs } = fakeWordPress();
    const echo = `Mot de passe ${WP_PASSWORD_COMPACT} refusé, en-tête Basic ${WP_TOKEN}`;
    const faults = [
      jsonResponse({ code: "x", message: echo }, 401),
      jsonResponse({ code: "x", message: echo }, 403),
      jsonResponse({ code: "x", message: echo }, 400),
      new Response(echo, { status: 500 }),
      new Response(echo, { status: 200 }),
    ];
    const messages: string[] = [];
    for (const fault of faults) {
      server.fail(() => true, fault);
      messages.push((await failure(client.createDraft(draft))).message);
    }
    server.fail(() => true, "network");
    messages.push((await failure(client.whoAmI())).message);

    expect(logs.length).toBeGreaterThanOrEqual(faults.length);
    for (const text of [...messages, ...logs]) expect(leaksSecret(text), text).toBe(false);
    expect(messages.join(" ")).toContain("[masqué]");
    expect(JSON.stringify(client)).not.toContain(WP_TOKEN);
    expect(String(Object.values(client))).not.toContain(WP_TOKEN);
  });

  it("secret recopié à cheval sur les limites de 200 (message) et 300 (journal) caractères", async () => {
    const { client, server, logs } = fakeWordPress();
    // Le secret commence quelques caractères avant la limite : tronquer d'abord en laisserait un morceau.
    const straddle = (secret: string, limit: number, prefix = "") =>
      `${prefix}${"x".repeat(limit - 12 - prefix.length)}${secret} fin`;
    // Partie du jeton Basic qui encode le mot de passe (« kora-redaction: » = 20 caractères base64).
    const tokenSecret = WP_TOKEN.slice(20);
    const fragments = (s: string) => Array.from({ length: s.length - 7 }, (_, i) => s.slice(i, i + 8));
    const forbidden = [...fragments(WP_PASSWORD_COMPACT), ...fragments(tokenSecret)];
    const faults = [
      jsonResponse({ code: "x", message: straddle(WP_PASSWORD_COMPACT, 200) }, 400),
      jsonResponse({ code: "x", message: straddle(WP_PASSWORD, 200) }, 403),
      htmlResponse(500, straddle(WP_PASSWORD_COMPACT, 300, "<html><pre>PHP_AUTH_PW=")),
      new Response(straddle(WP_PASSWORD, 300, "PHP_AUTH_PW="), { status: 502 }),
      // Jeton sans préfixe « Basic » : c'est sa partie « mot de passe » qui chevauche la limite.
      new Response(straddle(WP_TOKEN, 300 - 20, "HTTP_AUTHORIZATION="), { status: 500 }),
    ];
    const messages: string[] = [];
    for (const fault of faults) {
      server.fail(() => true, fault);
      messages.push((await failure(client.createDraft(draft))).message);
    }
    for (const text of [...messages, ...logs]) {
      expect(leaksSecret(text), text).toBe(false);
      expect(
        forbidden.find((f) => text.includes(f)),
        text,
      ).toBeUndefined();
    }
    expect(messages.slice(0, 2).every((m) => m.includes("[masqué]"))).toBe(true);
    expect(logs.filter((l) => l.includes("[masqué]")).length).toBeGreaterThanOrEqual(faults.length);
  });
});
