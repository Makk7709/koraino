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

  it("retrouve ses brouillons par titre exact et date, en excluant ceux des autres", async () => {
    const { client, server } = fakeWordPress();
    const title = "Verkor & Renault : -2 % sur les coûts";
    const old = new Date(NOW.getTime() - 3_600_000).toISOString().slice(0, 19);
    const mine = server.addPost({ title: "Verkor &amp; Renault : -2 % sur les coûts" });
    server.addPost({ title: "Verkor &amp; Renault : -2 % sur les coûts", author: OTHER_ACCOUNT });
    server.addPost({ title: "Verkor &amp; Renault : -2 % sur les coûts (2)" });
    server.addPost({ title: "Verkor &amp; Renault : -2 % sur les coûts", modified_gmt: old });
    server.addPost({ title: "Verkor &amp; Renault : -2 % sur les coûts", status: "publish" });
    const since = new Date(NOW.getTime() - 120_000).toISOString();
    const found = await client.findOwnDrafts(title, since);
    expect(found.map((p) => p.id)).toEqual([String(mine.id)]);
    const search = server.requests.find((r) => r.url.pathname.endsWith("/posts"))!.url.searchParams;
    expect(search.get("author")).toBe(String(KORA_ACCOUNT));
    expect(search.get("status")).toBe("draft,pending");
    // « -2 » serait une exclusion pour WordPress et « & » est stocké encodé.
    expect(search.get("search")).toBe("Verkor Renault sur les coûts");
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
});
