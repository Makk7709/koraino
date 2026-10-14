import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ApiErrorBody,
  Article,
  ArticleDetail,
  AuditEvent,
  PublicationAttempt,
  WordPressCheck,
} from "@/lib/api/types";
import { resetAdapters } from "@/server/adapters";
import { setClock } from "@/server/clock";
import { idempotencyKey } from "@/server/domain/workflow";
import type { PublicationRecord } from "@/server/store/records";
import type { Repository } from "@/server/store/repository";
import { call, NOW, setup, teardown, USERS } from "./helpers";
import {
  jsonResponse,
  KORA_ACCOUNT,
  leaksSecret,
  OTHER_ACCOUNT,
  useFakeWordPress,
  WP_SITE,
  type Recorded,
} from "./wordpress-fake";

const { redacteur: EDITOR, validateur: VALIDATOR } = USERS;

let repo: Repository;
let wp: ReturnType<typeof useFakeWordPress>;

beforeEach(() => {
  repo = setup();
  wp = useFakeWordPress();
});
afterEach(() => {
  vi.unstubAllEnvs();
  teardown();
});

type Reply = PublicationAttempt & ApiErrorBody;

const isWrite = (r: Recorded) => r.method === "POST";
const isDraftSearch = (r: Recorded) =>
  r.method === "GET" && r.url.pathname.endsWith("/posts") && r.url.searchParams.has("search");
const editUrl = (id: string | number) => `${WP_SITE}/wp-admin/post.php?post=${id}&action=edit`;

async function approvedArticle(signalId = "sig_verkor"): Promise<ArticleDetail> {
  const created = await call<ArticleDetail>("POST", "/articles", {
    body: { signalId },
    user: EDITOR,
  });
  expect(created.status).toBe(201);
  await call("POST", `/articles/${created.body.id}/submit`, { user: EDITOR });
  const approved = await call<ArticleDetail>("POST", `/articles/${created.body.id}/approve`, {
    body: { channel: "wordpress", version: 1 },
    user: VALIDATOR,
  });
  expect(approved.body.status).toBe("approuve");
  return approved.body;
}

/** Nouvelle version relue puis approuvée : même article, nouvelle clé d'envoi. */
async function approveNewVersion(id: string, title = "Verkor et Renault : version relue") {
  const edited = await call<ArticleDetail>("POST", `/articles/${id}/versions`, {
    body: { title, chapo: "Chapô relu.", body: "Corps relu.\n\n- Point clé" },
    user: EDITOR,
  });
  expect(edited.status).toBe(201);
  const approved = await call<ArticleDetail>("POST", `/articles/${id}/approve`, {
    body: { channel: "wordpress", version: edited.body.currentVersion },
    user: VALIDATOR,
  });
  expect(approved.body.status).toBe("approuve");
  return approved.body;
}

/** Deux articles distincts (signaux différents) au même titre. */
async function sameTitlePair() {
  const a = await approvedArticle();
  const b = await approvedArticle("sig_wattpark");
  await approveNewVersion(b.id, a.title);
  return { a, b };
}

const publish = (id: string, user: string = VALIDATOR) =>
  call<Reply>("POST", `/articles/${id}/publish`, { body: { channel: "wordpress" }, user });

const detail = async (id: string) => (await call<ArticleDetail>("GET", `/articles/${id}`)).body;

const attemptsOf = async (id: string) =>
  (await call<PublicationAttempt[]>("GET", `/publications?articleId=${id}`)).body;

const errorAttempt = (reply: { body: Reply }) =>
  (reply.body.error.details as { attempt: PublicationAttempt }).attempt;

describe("envoi d'un brouillon WordPress réel", () => {
  it("crée un brouillon : statut draft, HTML, étiquettes existantes, lien d'édition", async () => {
    const art = await approvedArticle();
    const version = art.versions[0]!;
    const res = await publish(art.id);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: "succes",
      remoteId: "100",
      mode: "brouillon_distant",
      version: 1,
      code: null,
    });
    expect(res.body.message).toContain(
      "Brouillon WordPress n° 100 créé (version 1). Aucune publication : la mise en ligne se fait dans WordPress.",
    );
    expect(res.body.message).toContain(
      "Aucune catégorie correspondante : WordPress appliquera sa catégorie par défaut.",
    );
    expect(res.body.message).toContain("ignorée(s)");
    expect(res.body.message).toContain("Mobilité");
    expect(res.body.message).not.toContain("démonstration");

    const writes = wp.server.writes();
    expect(writes).toHaveLength(1);
    expect(writes[0]!.url.pathname).toBe("/wp-json/wp/v2/posts");
    expect(writes[0]!.body).toMatchObject({
      title: version.title,
      excerpt: version.excerpt,
      status: "draft",
      tags: [23],
    });
    expect(writes[0]!.body).not.toHaveProperty("categories");
    expect(String(writes[0]!.body!["content"])).toMatch(/^<p><strong>/);

    const after = await detail(art.id);
    expect(after.wordpress).toEqual({
      remoteId: "100",
      status: "brouillon",
      lastSyncAt: expect.any(String),
      editUrl: editUrl(100),
    });
    expect(after.status).toBe("approuve");
    expect(after.signal?.status).toBe("traite");
    // Le site interne du lien n'est jamais exposé, ni en détail ni en liste.
    const list = await call<Article[]>("GET", "/articles");
    expect(list.body.find((a) => a.id === art.id)!.wordpress).toEqual(after.wordpress);
    expect(list.text).not.toMatch(/"site"/);
    expect((await call("GET", `/articles/${art.id}`)).text).not.toMatch(/"site"/);
    expect((await repo.articles.get(art.id))!.wordpress.site).toBe(WP_SITE);

    const audit = await call<AuditEvent[]>("GET", "/audit?limit=10");
    expect(audit.body.map((e) => e.action)).toContain("publication.success");
  });

  it("shortcodes neutralisés dans le contenu et l'extrait, titre laissé intact", async () => {
    const art = await approvedArticle();
    const edited = await call<ArticleDetail>("POST", `/articles/${art.id}/versions`, {
      body: {
        title: "[Exclusif] Verkor",
        chapo: "[gallery ids=1] Chapô",
        body: "Corps [À vérifier] [embed]https://exemple.fr/v[/embed]",
        excerpt: "Extrait [contact-form-7 id=3]",
      },
      user: EDITOR,
    });
    await call("POST", `/articles/${art.id}/approve`, {
      body: { channel: "wordpress", version: edited.body.currentVersion },
      user: VALIDATOR,
    });
    expect((await publish(art.id)).status).toBe(201);
    const body = wp.server.writes()[0]!.body!;
    expect(body["title"]).toBe("[Exclusif] Verkor");
    expect(body["excerpt"]).toBe("Extrait &#91;contact-form-7 id=3&#93;");
    expect(String(body["content"])).not.toMatch(/[[\]]/);
    expect(String(body["content"])).toContain("<mark>&#91;À vérifier&#93;</mark>");
  });

  it("rejoue sans rappeler WordPress tant que le brouillon est le courant", async () => {
    const art = await approvedArticle();
    const first = await publish(art.id);
    const requests = wp.server.requests.length;
    const again = await publish(art.id);
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(first.body.id);
    expect(wp.server.requests).toHaveLength(requests);
    const audit = await call<AuditEvent[]>("GET", "/audit?limit=5");
    expect(audit.body[0]!.action).toBe("publication.replay");
  });

  it("nouvelle version : met à jour le même brouillon, sans en créer d'autre", async () => {
    const art = await approvedArticle();
    await publish(art.id);
    await approveNewVersion(art.id);
    const res = await publish(art.id);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ remoteId: "100", version: 2 });
    expect(res.body.message).toContain("Brouillon WordPress n° 100 mis à jour (version 2).");
    expect(res.body.message).toContain("les catégories du brouillon sont conservées");
    const [, update] = wp.server.writes();
    expect(update!.url.pathname).toBe("/wp-json/wp/v2/posts/100");
    expect(update!.body).toMatchObject({
      title: "Verkor et Renault : version relue",
      status: "draft",
      content: `<p><strong>Chapô relu.</strong></p>\n<p>Corps relu.</p>\n<ul><li>Point clé</li></ul>\n<!-- kora:article=${art.id} -->`,
    });
    expect(wp.server.posts.size).toBe(1);
    expect(wp.server.posts.get(100)!.title).toBe("Verkor et Renault : version relue");
  });

  it("brouillon publié dans WordPress : 409, rien n'est écrit, l'article passe publié", async () => {
    const art = await approvedArticle();
    await publish(art.id);
    Object.assign(wp.server.posts.get(100)!, {
      status: "publish",
      date_gmt: "2026-10-12T09:15:00",
    });
    await approveNewVersion(art.id);
    const res = await publish(art.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("wordpress_remote_published");
    expect(res.body.error.message).toBe(
      "Ce contenu a déjà été publié ou programmé sur WordPress : KORA ne le modifie plus. Faites la mise à jour dans WordPress.",
    );
    expect(errorAttempt(res)).toMatchObject({
      status: "echec",
      code: "wordpress_remote_published",
    });
    expect(wp.server.writes()).toHaveLength(1);

    const after = await detail(art.id);
    expect(after.status).toBe("publie");
    expect(after.wordpress).toMatchObject({
      remoteId: "100",
      status: "publie",
      editUrl: editUrl(100),
    });
    expect((await repo.articles.get(art.id))!.publishedAt).toBe("2026-10-12T09:15:00.000Z");
    // L'approbation de la nouvelle version est conservée par le règlement.
    expect(after.approvals.some((a) => a.version === 2 && a.valid)).toBe(true);
  });

  it("brouillon programmé dans WordPress : 409 et état « programmé »", async () => {
    const art = await approvedArticle();
    await publish(art.id);
    wp.server.posts.get(100)!.status = "future";
    await approveNewVersion(art.id);
    const res = await publish(art.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("wordpress_remote_published");
    const after = await detail(art.id);
    expect(after.wordpress.status).toBe("programme");
    expect(after.status).toBe("approuve");
  });

  it.each([
    ["supprimé définitivement", null, "n'existe plus sur WordPress"],
    ["mis à la corbeille", "trash", "est dans la corbeille de WordPress"],
  ])("brouillon %s : un nouveau brouillon est créé", async (_label, status, note) => {
    const art = await approvedArticle();
    await publish(art.id);
    if (status) wp.server.posts.get(100)!.status = status;
    else wp.server.posts.delete(100);
    await approveNewVersion(art.id);
    const res = await publish(art.id);
    expect(res.status).toBe(201);
    expect(res.body.remoteId).toBe("101");
    expect(res.body.message).toContain("créé (version 2)");
    expect(res.body.message).toContain(`Le brouillon n° 100 ${note}`);
    expect(wp.server.writes().map((r) => r.url.pathname)).toEqual([
      "/wp-json/wp/v2/posts",
      "/wp-json/wp/v2/posts",
    ]);
  });

  it("404 passager (API filtrée) : envoi refusé, ni « supprimé » ni doublon", async () => {
    const art = await approvedArticle();
    await publish(art.id);
    await approveNewVersion(art.id);
    wp.server.fail(
      (r) => r.method === "GET" && r.url.pathname.endsWith("/posts/100"),
      jsonResponse({ code: "rest_no_route", message: "Aucune route correspondante." }, 404),
    );
    const res = await publish(art.id);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("wordpress_invalid");
    expect(errorAttempt(res).status).toBe("echec");
    expect(wp.server.writes()).toHaveLength(1);
    expect((await detail(art.id)).wordpress.status).toBe("brouillon");
    const retry = await publish(art.id);
    expect(retry.body).toMatchObject({ status: "succes", remoteId: "100" });
    expect(wp.server.posts.size).toBe(1);
  });

  it("lien « supprimé » : l'ancien brouillon est relu, restauré il est mis à jour sans doublon", async () => {
    const art = await approvedArticle();
    await publish(art.id);
    const saved = { ...wp.server.posts.get(100)! };
    wp.server.posts.delete(100);
    const gone = await call<ArticleDetail>("POST", `/articles/${art.id}/wordpress/refresh`, {
      user: VALIDATOR,
    });
    expect(gone.body.wordpress.status).toBe("supprime");
    // Restauré depuis la corbeille (ou 404 passager à l'actualisation) : il existe toujours.
    wp.server.posts.set(100, saved);
    await approveNewVersion(art.id);
    const res = await publish(art.id);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ remoteId: "100", version: 2 });
    expect(res.body.message).toContain("mis à jour (version 2)");
    expect(wp.server.posts.size).toBe(1);
    expect((await detail(art.id)).wordpress.status).toBe("brouillon");
  });

  it("contenu en attente de relecture : la mise à jour le laisse en attente", async () => {
    const art = await approvedArticle();
    await publish(art.id);
    wp.server.posts.get(100)!.status = "pending";
    await approveNewVersion(art.id);
    const res = await publish(art.id);
    expect(res.status).toBe(201);
    expect(wp.server.writes()[1]!.body).toMatchObject({ status: "pending" });
    expect(wp.server.posts.get(100)!.status).toBe("pending");
    expect((await detail(art.id)).wordpress.status).toBe("en_attente");
  });

  it("brouillon devenu inaccessible (autre auteur) : jamais modifié, nouveau brouillon", async () => {
    const art = await approvedArticle();
    await publish(art.id);
    const original = { ...wp.server.posts.get(100)!, author: OTHER_ACCOUNT };
    wp.server.posts.set(100, { ...original });
    await approveNewVersion(art.id);
    const res = await publish(art.id);
    expect(res.status).toBe(201);
    expect(res.body.remoteId).toBe("101");
    expect(res.body.message).toContain("n'est plus accessible au compte KORA");
    expect(wp.server.posts.get(100)).toEqual(original);
    expect(wp.server.writes().some((r) => r.url.pathname.endsWith("/posts/100"))).toBe(false);
  });

  it("ancien identifiant simulé (wp-NNNN) : jamais réutilisé, ni même demandé au site", async () => {
    const before = await detail("art_pasqal");
    expect(before.wordpress).toMatchObject({ remoteId: "wp-4821", editUrl: null });
    const res = await publish("art_pasqal");
    expect(res.status).toBe(201);
    expect(res.body.remoteId).toBe("100");
    expect(res.body.message).toContain("L'ancien brouillon wp-4821 était simulé (démonstration)");
    expect(wp.server.requests.some((r) => r.url.href.includes("4821"))).toBe(false);
    expect((await detail("art_pasqal")).wordpress).toMatchObject({
      remoteId: "100",
      editUrl: editUrl(100),
    });
  });

  it("identifiant d'un autre site (préproduction) : jamais réutilisé, lien d'édition masqué", async () => {
    const art = await approvedArticle();
    const homonym = wp.server.addPost({ title: "Contenu de production homonyme" });
    const rec = (await repo.articles.get(art.id))!;
    await repo.articles.update({
      ...rec,
      wordpress: {
        remoteId: String(homonym.id),
        site: "https://preprod.example.test",
        status: "brouillon",
        lastSyncAt: rec.updatedAt,
      },
    });
    expect((await detail(art.id)).wordpress.editUrl).toBeNull();
    const res = await publish(art.id);
    expect(res.status).toBe(201);
    expect(res.body.remoteId).toBe("101");
    expect(res.body.message).toContain(
      "provient d'un autre site WordPress (https://preprod.example.test)",
    );
    expect(wp.server.posts.get(homonym.id)!.title).toBe("Contenu de production homonyme");
    expect(wp.server.requests.some((r) => r.url.pathname.endsWith(`/posts/${homonym.id}`))).toBe(
      false,
    );
  });

  it("deux demandes simultanées : un seul brouillon, l'autre est refusée ou rejouée", async () => {
    const art = await approvedArticle();
    const replies = await Promise.all([publish(art.id), publish(art.id), publish(art.id)]);
    const statuses = replies.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    for (const r of replies.filter((x) => x.status !== 201)) {
      if (r.status === 409) expect(r.body.error.code).toBe("publication_in_progress");
      else expect(r.status).toBe(200);
    }
    expect(wp.server.writes()).toHaveLength(1);
    expect(wp.server.posts.size).toBe(1);
    expect((await attemptsOf(art.id)).filter((p) => p.status === "succes")).toHaveLength(1);
    // Verrou libéré : l'envoi suivant est un simple rejeu.
    expect((await publish(art.id)).status).toBe(200);
  });

  it("verrou détenu par une autre instance : 409 publication_in_progress, aucun appel", async () => {
    const art = await approvedArticle();
    const token = await repo.acquireLock(`wordpress-publish:${art.id}`, 120_000);
    expect(token).not.toBeNull();
    const res = await publish(art.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("publication_in_progress");
    expect(wp.server.requests).toHaveLength(0);
  });
});

describe("retouches faites dans WordPress depuis le dernier envoi", () => {
  const REMOTE_MODIFIED =
    "Le brouillon a été modifié dans WordPress depuis le dernier envoi de KORA. Reprenez ces retouches dans KORA, ou confirmez l'écrasement.";
  const later = (minutes: number) =>
    new Date(NOW.getTime() + minutes * 60_000).toISOString().slice(0, 19);
  const retouch = (minutes = 5) =>
    Object.assign(wp.server.posts.get(100)!, {
      content: "<p>Texte retravaillé par la rédaction dans WordPress</p>",
      modified_gmt: later(minutes),
    });
  const overwrite = (id: string, value: unknown = true) =>
    call<Reply>("POST", `/articles/${id}/publish`, {
      body: { channel: "wordpress", overwriteRemoteChanges: value },
      user: VALIDATOR,
    });

  it("409 wordpress_remote_modified, rien n'est écrit ; l'écrasement confirmé passe", async () => {
    const art = await approvedArticle();
    await publish(art.id);
    retouch();
    await approveNewVersion(art.id);
    const res = await publish(art.id);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: "wordpress_remote_modified",
      message: REMOTE_MODIFIED,
      details: { editUrl: editUrl(100), remoteModifiedAt: `${later(5)}.000Z` },
    });
    expect(errorAttempt(res)).toMatchObject({ status: "echec", code: "wordpress_remote_modified" });
    expect(wp.server.writes()).toHaveLength(1);
    expect(wp.server.posts.get(100)!.content).toContain("retravaillé");

    expect((await overwrite(art.id, "oui")).status).toBe(400);
    const confirmed = await overwrite(art.id);
    expect(confirmed.status).toBe(201);
    expect(confirmed.body.message).toContain("ont été remplacées (écrasement confirmé)");
    expect(wp.server.posts.get(100)!.content).toContain("Chapô relu.");

    // La date de référence suit l'écriture de KORA : la version suivante passe sans refus.
    await approveNewVersion(art.id, "Verkor et Renault : troisième version");
    expect((await publish(art.id)).status).toBe(201);
  });

  it("une actualisation ne blanchit pas une retouche : le renvoi reste refusé", async () => {
    const art = await approvedArticle();
    await publish(art.id);
    retouch();
    const refreshed = await call<ArticleDetail>("POST", `/articles/${art.id}/wordpress/refresh`, {
      user: VALIDATOR,
    });
    expect(refreshed.status).toBe(200);
    expect(refreshed.text).not.toContain("sentModifiedGmt");
    await approveNewVersion(art.id);
    const res = await publish(art.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("wordpress_remote_modified");
  });

  it("lien antérieur à ce suivi (aucune date mémorisée) : pas de blocage", async () => {
    const art = await approvedArticle();
    await publish(art.id);
    const rec = (await repo.articles.get(art.id))!;
    const { sentModifiedGmt: _sent, ...legacy } = rec.wordpress;
    await repo.articles.update({ ...rec, wordpress: legacy });
    retouch();
    await approveNewVersion(art.id);
    expect((await publish(art.id)).status).toBe(201);
  });
});

describe("rôle du compte WordPress imposé par le serveur", () => {
  const ROLE_MESSAGE =
    "Le compte WordPress utilisé par KORA peut publier : par sécurité, KORA exige un compte de rôle Contributeur. Un administrateur doit changer le rôle du compte dans WordPress.";
  const meCalls = () => wp.server.requests.filter((r) => r.url.pathname.endsWith("/users/me"));

  it("compte capable de publier : 503 wordpress_role_too_high, aucune écriture", async () => {
    const art = await approvedArticle();
    wp.server.me.roles = ["editor"];
    wp.server.me.capabilities["publish_posts"] = true;
    const res = await publish(art.id);
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({ code: "wordpress_role_too_high", message: ROLE_MESSAGE });
    expect(errorAttempt(res)).toMatchObject({ status: "echec", code: "wordpress_role_too_high" });
    expect(wp.server.writes()).toHaveLength(0);
    expect(wp.server.requests.map((r) => r.url.pathname)).toEqual(["/wp-json/wp/v2/users/me"]);
    expect((await detail(art.id)).wordpress.remoteId).toBeNull();
  });

  it("y compris pour reprendre un envoi interrompu : rien n'est recherché ni écrit", async () => {
    const art = await approvedArticle();
    wp.server.fail(isWrite, "timeout", { afterApply: true });
    await publish(art.id);
    wp.server.me.capabilities["publish_posts"] = true;
    setClock(() => new Date(NOW.getTime() + 5 * 60_000 + 1000));
    const res = await publish(art.id);
    expect(res.status).toBe(503);
    expect(wp.server.requests.some(isDraftSearch)).toBe(false);
    expect(wp.server.writes()).toHaveLength(1);
  });

  it("droits gardés en mémoire 5 min au plus : un compte promu ensuite est refusé", async () => {
    const art = await approvedArticle();
    expect((await publish(art.id)).status).toBe(201);
    await approveNewVersion(art.id);
    expect((await publish(art.id)).status).toBe(201);
    expect(meCalls()).toHaveLength(1);

    wp.server.me.capabilities["publish_posts"] = true;
    setClock(() => new Date(NOW.getTime() + 5 * 60_000 + 1000));
    await approveNewVersion(art.id, "Verkor et Renault : troisième version");
    const late = await publish(art.id);
    expect(late.status).toBe(503);
    expect(late.body.error.code).toBe("wordpress_role_too_high");
    expect(meCalls()).toHaveLength(2);
    expect(wp.server.writes()).toHaveLength(2);
  });

  it("le test de connexion relit les droits : refus immédiat, sans attendre", async () => {
    const art = await approvedArticle();
    await publish(art.id);
    wp.server.me.capabilities["publish_posts"] = true;
    const check = await call<WordPressCheck>("GET", "/wordpress/check", { user: USERS.admin });
    expect(check.body).toMatchObject({ ok: true, canPublish: true });
    await approveNewVersion(art.id);
    const res = await publish(art.id);
    expect(res.status).toBe(503);
    expect(wp.server.writes()).toHaveLength(1);
  });

  it("droits illisibles : envoi poursuivi, avertissement sans secret", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const art = await approvedArticle();
    wp.server.fail(
      (r) => r.url.pathname.endsWith("/users/me"),
      jsonResponse({ id: KORA_ACCOUNT, name: "KORA Rédaction", roles: ["contributor"] }),
    );
    const res = await publish(art.id);
    expect(res.status).toBe(201);
    const lines = warn.mock.calls.map((c) => c.join(" "));
    expect(lines.some((l) => l.includes("rôle Contributeur non vérifié"))).toBe(true);
    expect(lines.some(leaksSecret)).toBe(false);
    warn.mockRestore();
  });
});

describe("reprise après un envoi interrompu", () => {
  it("création au résultat inconnu : le marqueur reste « vérification requise »", async () => {
    const art = await approvedArticle();
    wp.server.fail(isWrite, "timeout", { afterApply: true });
    const res = await publish(art.id);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("wordpress_unavailable");
    expect(res.body.error.message).toContain("au prochain envoi, KORA le recherchera");
    expect(errorAttempt(res)).toMatchObject({
      status: "verification_requise",
      code: "wordpress_unavailable",
      remoteId: null,
    });
    expect((await detail(art.id)).wordpress.remoteId).toBeNull();
  });

  it("1 candidat : brouillon adopté puis mis à jour, aucun doublon", async () => {
    const art = await approvedArticle();
    wp.server.fail(isWrite, "timeout", { afterApply: true });
    const lost = await publish(art.id);
    expect(wp.server.posts.size).toBe(1);

    const res = await publish(art.id);
    expect(res.status).toBe(201);
    expect(res.body.remoteId).toBe("100");
    expect(res.body.message).toContain("mis à jour (version 1)");
    expect(res.body.message).toContain("Brouillon retrouvé après une interruption (n° 100).");
    expect(wp.server.posts.size).toBe(1);
    expect(wp.server.writes().map((r) => r.url.pathname)).toEqual([
      "/wp-json/wp/v2/posts",
      "/wp-json/wp/v2/posts/100",
    ]);
    const search = wp.server.requests.find(
      (r) => r.method === "GET" && r.url.pathname.endsWith("/posts"),
    )!;
    expect(search.url.searchParams.get("status")).toBe("draft,pending");

    const attempts = await attemptsOf(art.id);
    expect(attempts.find((p) => p.id === errorAttempt(lost).id)).toMatchObject({
      status: "succes",
      code: "wordpress_recovered",
      remoteId: "100",
    });
    expect(attempts.some((p) => p.status === "verification_requise")).toBe(false);
    expect((await detail(art.id)).wordpress).toMatchObject({
      remoteId: "100",
      status: "brouillon",
    });
  });

  it("0 candidat : absence confirmée, puis création", async () => {
    const art = await approvedArticle();
    wp.server.fail(isWrite, "network");
    const lost = await publish(art.id);
    expect(errorAttempt(lost).status).toBe("verification_requise");
    expect(wp.server.posts.size).toBe(0);

    const res = await publish(art.id);
    expect(res.status).toBe(201);
    expect(res.body.message).toContain("créé (version 1)");
    expect(wp.server.posts.size).toBe(1);
    const marker = (await attemptsOf(art.id)).find((p) => p.id === errorAttempt(lost).id);
    expect(marker).toMatchObject({ status: "echec", code: "wordpress_absence_confirmed" });
  });

  it("plusieurs candidats : 409 avec la liste, rien n'est écrit tant que les doublons restent", async () => {
    const art = await approvedArticle();
    wp.server.fail(isWrite, "timeout", { afterApply: true });
    await publish(art.id);
    // Second envoi interrompu du même article : même marqueur.
    const lost = wp.server.posts.get(100)!;
    const twin = wp.server.addPost({ title: lost.title, content: lost.content });

    const res = await publish(art.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("publication_verification_required");
    expect(res.body.error.message).toBe(
      "Plusieurs brouillons de cet article existent sur WordPress après des envois interrompus : supprimez les doublons dans WordPress puis renvoyez.",
    );
    const { candidates } = res.body.error.details as {
      candidates: { id: string; title: string; date: string | null; editUrl: string }[];
    };
    expect(candidates.map((c) => c.id).sort()).toEqual(["100", String(twin.id)]);
    expect(candidates[0]).toMatchObject({ editUrl: editUrl(candidates[0]!.id) });
    expect(candidates.every((c) => c.date)).toBe(true);
    expect(wp.server.writes()).toHaveLength(1);

    wp.server.posts.delete(twin.id);
    const resolved = await publish(art.id);
    expect(resolved.status).toBe(201);
    expect(resolved.body.remoteId).toBe("100");
    expect(wp.server.posts.size).toBe(1);
  });

  it("même titre, autre article envoyé avant l'interruption : son brouillon n'est ni repris ni modifié", async () => {
    const { a, b } = await sameTitlePair();
    expect((await publish(b.id)).body.remoteId).toBe("100");
    const before = { ...wp.server.posts.get(100)! };
    wp.server.fail(isWrite, "network");
    expect(errorAttempt(await publish(a.id)).status).toBe("verification_requise");

    const res = await publish(a.id);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ remoteId: "101", version: 1 });
    expect(res.body.message).toContain("créé (version 1)");
    expect(wp.server.posts.get(100)).toEqual(before);
    expect(wp.server.writes().map((r) => r.url.pathname)).not.toContain("/wp-json/wp/v2/posts/100");
    expect((await detail(a.id)).wordpress.remoteId).toBe("101");
    expect((await detail(b.id)).wordpress.remoteId).toBe("100");
    const search = wp.server.requests.find(isDraftSearch)!;
    expect(search.url.searchParams.get("search")).toBe(`kora:article=${a.id}`);
  });

  it("même titre, autre article créé après l'interruption : son brouillon n'est pas repris", async () => {
    const { a, b } = await sameTitlePair();
    wp.server.fail(isWrite, "network");
    await publish(a.id);
    expect((await publish(b.id)).body.remoteId).toBe("100");
    const before = { ...wp.server.posts.get(100)! };

    const res = await publish(a.id);
    expect(res.body.remoteId).toBe("101");
    expect(wp.server.posts.get(100)).toEqual(before);
    expect((await detail(b.id)).wordpress.remoteId).toBe("100");
  });

  it("marqueur recopié dans le brouillon d'un autre article : écarté, nouveau brouillon", async () => {
    const { a, b } = await sameTitlePair();
    wp.server.fail(isWrite, "network");
    const lost = await publish(a.id);
    await publish(b.id);
    // Contenu de A recopié dans le brouillon de B (éditeur de code de WordPress).
    wp.server.posts.get(100)!.content += `\n<!-- kora:article=${a.id} -->`;

    const res = await publish(a.id);
    expect(res.body.remoteId).toBe("101");
    const marker = (await attemptsOf(a.id)).find((p) => p.id === errorAttempt(lost).id);
    expect(marker).toMatchObject({ status: "echec", code: "wordpress_absence_confirmed" });
    expect(marker!.message).toContain("déjà lié à un autre article");
  });

  it("création interrompue sur un autre site ou sans site connu : close sans recherche", async () => {
    const art = await approvedArticle();
    const interrupted = (id: string, site?: string | null): PublicationRecord => ({
      id,
      idempotencyKey: idempotencyKey(art.id, 1, "wordpress"),
      articleId: art.id,
      linkedinPostId: null,
      newsletterId: null,
      channel: "wordpress",
      version: 1,
      status: "verification_requise",
      code: "wordpress_confirmation_pending",
      message: "Création du brouillon WordPress envoyée, confirmation en attente.",
      attempts: 1,
      remoteId: null,
      mode: "brouillon_distant",
      at: NOW.toISOString(),
      by: "Claire Dubois",
      byUserId: null,
      ...(site === undefined ? {} : { site }),
    });
    await repo.publications.insert(interrupted("pub_preprod", "https://preprod.example.test"));
    await repo.publications.insert(interrupted("pub_ancien"));
    // Reprenable s'il était recherché : il ne doit pas l'être.
    wp.server.addPost({ title: art.title, content: `<p>x</p>\n<!-- kora:article=${art.id} -->` });

    const res = await publish(art.id);
    expect(res.status).toBe(201);
    expect(res.body.remoteId).toBe("101");
    expect(wp.server.requests.some(isDraftSearch)).toBe(false);
    const attempts = await call<PublicationAttempt[]>("GET", `/publications?articleId=${art.id}`);
    expect(attempts.text).not.toMatch(/"site"/);
    const preprod = attempts.body.find((p) => p.id === "pub_preprod")!;
    expect(preprod).toMatchObject({ status: "echec", code: "wordpress_recovery_skipped" });
    expect(preprod.message).toContain("autre site WordPress (https://preprod.example.test)");
    const legacy = attempts.body.find((p) => p.id === "pub_ancien")!;
    expect(legacy).toMatchObject({ status: "echec", code: "wordpress_recovery_skipped" });
    expect(legacy.message).toContain("Vérifiez dans WordPress qu'aucun doublon n'existe.");
  });

  it("contenu brut illisible : rien n'est repris, nouveau brouillon", async () => {
    const art = await approvedArticle();
    wp.server.fail(isWrite, "timeout", { afterApply: true });
    const lost = await publish(art.id);
    const post = wp.server.posts.get(100)!;
    const content = post.content;
    // Extension qui retire `content.raw` des réponses : seul le rendu reste.
    wp.server.fail(
      isDraftSearch,
      jsonResponse([
        {
          id: 100,
          status: "draft",
          author: KORA_ACCOUNT,
          modified_gmt: post.modified_gmt,
          title: { raw: post.title },
          content: { rendered: content },
        },
      ]),
    );

    const res = await publish(art.id);
    expect(res.body.remoteId).toBe("101");
    expect(wp.server.posts.get(100)!.content).toBe(content);
    const marker = (await attemptsOf(art.id)).find((p) => p.id === errorAttempt(lost).id);
    expect(marker!.message).toContain("contenu illisible");
  });

  it("brouillon retouché après la fenêtre de reprise : non repris, la retouche reste", async () => {
    const art = await approvedArticle();
    wp.server.fail(isWrite, "timeout", { afterApply: true });
    await publish(art.id);
    const later = new Date(NOW.getTime() + 60 * 60_000);
    setClock(() => later);
    const post = wp.server.posts.get(100)!;
    post.content += "\n<p>Retouche de la rédaction</p>";
    post.modified_gmt = later.toISOString().slice(0, 19);

    const res = await publish(art.id);
    expect(res.body.remoteId).toBe("101");
    expect(wp.server.posts.get(100)!.content).toContain("Retouche de la rédaction");
  });

  it("création enregistrée au statut inattendu : liée, relue avant tout renvoi, jamais de doublon", async () => {
    const art = await approvedArticle();
    wp.server.createStatus = "pitch";
    const first = await publish(art.id);
    wp.server.createStatus = null;
    expect(first.status).toBe(502);
    expect(first.body.error.message).not.toContain("Aucun brouillon n'a été créé");
    expect(first.body.error.message).toContain("Le brouillon n° 100 est lié à l'article");
    expect(errorAttempt(first)).toMatchObject({ status: "verification_requise", remoteId: "100" });
    expect((await detail(art.id)).wordpress).toMatchObject({ remoteId: "100", status: "brouillon" });

    // Statut toujours inconnu : relu, refusé, rien n'est écrit.
    const blocked = await publish(art.id);
    expect(blocked.status).toBe(502);
    expect(blocked.body.error.message).toContain("statut inattendu");
    expect(wp.server.writes()).toHaveLength(1);

    // Remis en brouillon dans WordPress : la création est confirmée, puis mise à jour.
    wp.server.posts.get(100)!.status = "draft";
    const res = await publish(art.id);
    expect(res.status).toBe(201);
    expect(res.body.remoteId).toBe("100");
    expect(wp.server.posts.size).toBe(1);
    const created = (await attemptsOf(art.id)).find((p) => p.id === errorAttempt(first).id);
    expect(created).toMatchObject({ status: "succes", remoteId: "100" });
    expect(created!.message).toContain("Brouillon WordPress n° 100 confirmé");
  });

  it("création au statut inattendu puis supprimée dans WordPress : échec constaté, nouveau brouillon", async () => {
    const art = await approvedArticle();
    wp.server.createStatus = "pitch";
    const first = await publish(art.id);
    wp.server.createStatus = null;
    wp.server.posts.delete(100);
    const res = await publish(art.id);
    expect(res.status).toBe(201);
    expect(res.body.remoteId).toBe("101");
    const created = (await attemptsOf(art.id)).find((p) => p.id === errorAttempt(first).id);
    expect(created).toMatchObject({ status: "echec", code: "wordpress_absence_confirmed" });
  });

  it("une interruption sur la v1 n'entraîne pas de doublon lors de l'envoi de la v2", async () => {
    const art = await approvedArticle();
    wp.server.fail(isWrite, "timeout", { afterApply: true });
    await publish(art.id);
    // Titre changé : le brouillon perdu de la v1 est retrouvé par le marqueur de l'article.
    await approveNewVersion(art.id);
    const res = await publish(art.id);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ remoteId: "100", version: 2 });
    expect(wp.server.posts.size).toBe(1);
  });

  it("mise à jour interrompue : échec simple, renvoyée sur le même brouillon", async () => {
    const art = await approvedArticle();
    await publish(art.id);
    await approveNewVersion(art.id);
    wp.server.fail(isWrite, "timeout", { afterApply: true });
    const lost = await publish(art.id);
    expect(lost.status).toBe(502);
    expect(errorAttempt(lost)).toMatchObject({ status: "echec", remoteId: "100" });
    expect(lost.body.error.message).toContain("vous pouvez renvoyer sans risque de doublon");

    const res = await publish(art.id);
    expect(res.status).toBe(201);
    expect(res.body.remoteId).toBe("100");
    expect(wp.server.posts.size).toBe(1);
  });

  it("erreur sûre (403 JSON) : échec, aucune recherche de reprise au renvoi", async () => {
    const art = await approvedArticle();
    wp.server.fail(
      isWrite,
      jsonResponse({ code: "rest_cannot_create", message: "Désolé, vous ne pouvez pas." }, 403),
    );
    const refused = await publish(art.id);
    expect(refused.status).toBe(502);
    expect(refused.body.error.code).toBe("wordpress_forbidden");
    expect(refused.body.error.message).toContain("Aucun brouillon n'a été créé.");
    expect(errorAttempt(refused).status).toBe("echec");

    const res = await publish(art.id);
    expect(res.status).toBe(201);
    expect(
      wp.server.requests.some((r) => r.method === "GET" && r.url.pathname.endsWith("/posts")),
    ).toBe(false);
  });

  it("échec avant écriture (site bloqué) : tentatives identiques cumulées", async () => {
    const art = await approvedArticle();
    const blocked = () =>
      new Response("<html>Attention Required! | Cloudflare</html>", {
        status: 403,
        headers: { "content-type": "text/html" },
      });
    wp.server.fail(() => true, blocked());
    const first = await publish(art.id);
    wp.server.fail(() => true, blocked());
    const second = await publish(art.id);
    expect(first.body.error.code).toBe("wordpress_blocked");
    expect(errorAttempt(second)).toMatchObject({
      id: errorAttempt(first).id,
      status: "echec",
      attempts: 2,
    });
    expect(wp.server.writes()).toHaveLength(0);
  });
});

describe("mode non configuré", () => {
  it("503 wordpress_not_configured, aucun succès ni faux brouillon", async () => {
    vi.stubEnv("WORDPRESS_URL", WP_SITE);
    resetAdapters();
    const art = await approvedArticle();
    const res = await publish(art.id);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("wordpress_not_configured");
    expect(res.body.error.message).toContain("WORDPRESS_USERNAME et WORDPRESS_APP_PASSWORD");
    const attempts = await attemptsOf(art.id);
    expect(attempts.some((p) => p.status === "succes")).toBe(false);
    expect(attempts.every((p) => p.remoteId === null)).toBe(true);
    expect((await detail(art.id)).wordpress).toEqual({
      remoteId: null,
      status: "aucun",
      lastSyncAt: null,
      editUrl: null,
    });

    const pasqal = await publish("art_pasqal");
    expect(pasqal.status).toBe(503);
    expect((await detail("art_pasqal")).wordpress.editUrl).toBeNull();
  });
});

describe("droits", () => {
  it("lecteur et rédacteur ne peuvent pas envoyer vers WordPress", async () => {
    for (const user of [USERS.lecteur, EDITOR]) {
      const res = await publish("art_pasqal", user);
      expect(res.status).toBe(403);
    }
    expect(wp.server.requests).toHaveLength(0);
  });
});
