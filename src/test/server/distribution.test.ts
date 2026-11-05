import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  ApiErrorBody,
  Dashboard,
  LinkedInPost,
  NewsletterEdition,
  PublicationAttempt,
  SearchResult,
  Signal,
} from "@/lib/api/types";
import { call, setup, teardown, USERS } from "./helpers";

beforeEach(() => setup());
afterEach(teardown);

const { redacteur: EDITOR, validateur: VALIDATOR } = USERS;

describe("WF4 : LinkedIn (export, API non disponible)", () => {
  it("approuve la version relue, invalide après modification et exporte une seule fois", async () => {
    const posts = await call<LinkedInPost[]>("GET", "/linkedin");
    expect(posts.body.filter((p) => p.status === "a_valider")).toHaveLength(5);
    const post = posts.body.find((p) => p.id === "li_pasqal")!;

    const stale = await call<ApiErrorBody>("POST", "/linkedin/li_pasqal/approve", {
      body: { version: post.version + 1 },
      user: VALIDATOR,
    });
    expect(stale.status).toBe(409);
    const approved = await call<LinkedInPost>("POST", "/linkedin/li_pasqal/approve", {
      body: { version: post.version },
      user: VALIDATOR,
    });
    expect(approved.body).toMatchObject({
      status: "approuve",
      approval: { valid: true, version: post.version, approvedBy: "Claire Dubois" },
    });

    const other = post.variants.find((v) => v.id !== post.selectedVariantId)!;
    const edited = await call<LinkedInPost>("PATCH", "/linkedin/li_pasqal", {
      body: { selectedVariantId: other.id },
      user: EDITOR,
    });
    expect(edited.body).toMatchObject({
      status: "a_valider",
      version: post.version + 1,
      selectedVariantId: other.id,
    });
    expect(edited.body.approval).toMatchObject({
      valid: false,
      invalidatedReason: "Contenu modifié après approbation",
    });

    const blocked = await call<ApiErrorBody>("POST", "/linkedin/li_pasqal/publish", {
      user: VALIDATOR,
    });
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe("approval_invalidated");

    await call("POST", "/linkedin/li_pasqal/approve", {
      body: { version: post.version + 1 },
      user: VALIDATOR,
    });
    const exported = await call<PublicationAttempt>("POST", "/linkedin/li_pasqal/publish", {
      user: VALIDATOR,
    });
    expect(exported.status).toBe(201);
    expect(exported.body).toMatchObject({
      status: "succes",
      mode: "export",
      channel: "linkedin",
      code: "linkedin_api_unavailable",
    });
    const again = await call<PublicationAttempt>("POST", "/linkedin/li_pasqal/publish", {
      user: VALIDATOR,
    });
    expect(again.body.id).toBe(exported.body.id);
    const after = await call<LinkedInPost[]>("GET", "/linkedin");
    expect(after.body.find((p) => p.id === "li_pasqal")!.status).toBe("exporte");

    const file = await call("GET", "/linkedin/li_pasqal/export");
    expect(file.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(file.headers.get("content-disposition")).toContain("attachment");
    expect(file.text).toContain(other.text);
    expect(file.text).not.toContain("APERÇU");
  });

  it("génère des variantes depuis un article et refuse un doublon en préparation", async () => {
    const posts = await call<LinkedInPost[]>("GET", "/linkedin");
    const busy = new Set(posts.body.map((p) => p.articleId));
    const articles = await call<{ id: string; signalId: string | null }[]>(
      "GET",
      "/articles?status=en_revue",
    );
    const target = articles.body.find((a) => a.signalId && !busy.has(a.id))!;
    const created = await call<LinkedInPost>("POST", "/linkedin", {
      body: { articleId: target.id },
      user: EDITOR,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      status: "brouillon",
      version: 1,
      articleId: target.id,
      signalId: target.signalId,
    });
    expect(created.body.variants.length).toBeGreaterThanOrEqual(2);
    const dup = await call<ApiErrorBody>("POST", "/linkedin", {
      body: { articleId: target.id },
      user: EDITOR,
    });
    expect(dup.status).toBe(409);
    const submitted = await call<LinkedInPost>("POST", `/linkedin/${created.body.id}/submit`, {
      user: EDITOR,
    });
    expect(submitted.body.status).toBe("a_valider");
    const empty = await call<ApiErrorBody>("POST", "/linkedin", { body: {}, user: EDITOR });
    expect(empty.status).toBe(400);
  });
});

describe("WF5 : newsletter (export, jamais d'envoi)", () => {
  it("compose, approuve la version relue, invalide après modification et exporte", async () => {
    const edition = (await call<NewsletterEdition>("GET", "/newsletters/nl_current")).body;
    expect(edition).toMatchObject({
      status: "composition",
      version: 6,
      title: "L'actualité innovation en Auvergne-Rhône-Alpes",
    });
    expect(edition.items).toHaveLength(12);
    expect(edition.items.map((i) => i.order)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));

    const dup = await call<ApiErrorBody>("POST", "/newsletters/nl_current/items", {
      body: { signalId: "sig_pasqal", version: 6, revision: 0 },
      user: EDITOR,
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("already_in_newsletter");

    const stale = await call<ApiErrorBody>("POST", "/newsletters/nl_current/approve", {
      body: { version: 5, revision: 0 },
      user: VALIDATOR,
    });
    expect(stale.status).toBe(409);
    const approved = await call<NewsletterEdition>("POST", "/newsletters/nl_current/approve", {
      body: { version: 6, revision: 0 },
      user: VALIDATOR,
    });
    expect(approved.body.status).toBe("approuvee");

    const [first, second] = edition.items;
    const reordered = await call<NewsletterEdition>("PATCH", "/newsletters/nl_current", {
      body: {
        version: 6,
        revision: 1,
        items: [{ id: first!.id, summary: "Résumé relu.", order: 20 }],
      },
      user: EDITOR,
    });
    expect(reordered.body).toMatchObject({ status: "composition", version: 7 });
    expect(reordered.body.approval).toMatchObject({
      valid: false,
      invalidatedReason: "Contenu modifié après approbation",
    });
    expect(reordered.body.items[0]!.id).toBe(second!.id);
    expect(reordered.body.items.at(-1)).toMatchObject({
      id: first!.id,
      summary: "Résumé relu.",
      order: 12,
    });
    const unknown = await call<ApiErrorBody>("PATCH", "/newsletters/nl_current", {
      body: { version: 7, revision: 2, items: [{ id: "nli_absent", summary: "x", order: 1 }] },
      user: EDITOR,
    });
    expect(unknown.status).toBe(422);

    const removed = await call<NewsletterEdition>(
      "DELETE",
      `/newsletters/nl_current/items/${second!.id}`,
      { user: EDITOR, body: { version: 7, revision: 2 } },
    );
    expect(removed.body.items).toHaveLength(11);
    expect(removed.body.version).toBe(8);

    const preview = await call("GET", "/newsletters/nl_current/export?format=html", {
      user: VALIDATOR,
    });
    expect(preview.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(preview.text).toMatch(/aperçu/i);
    expect((await call<NewsletterEdition>("GET", "/newsletters/nl_current")).body.status).toBe(
      "composition",
    );

    const early = await call<ApiErrorBody>("POST", "/newsletters/nl_current/export", {
      user: VALIDATOR,
      body: { version: 8, revision: 3 },
    });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe("approval_missing");

    await call("POST", "/newsletters/nl_current/approve", {
      body: { version: 8, revision: 3 },
      user: VALIDATOR,
    });
    const exported = await call("GET", "/newsletters/nl_current/export?format=txt", {
      user: VALIDATOR,
    });
    expect(exported.headers.get("content-disposition")).toMatch(/newsletter-.*-v8\.txt/);
    expect(exported.text).not.toMatch(/aperçu/i);
    expect((await call<NewsletterEdition>("GET", "/newsletters/nl_current")).body.status).toBe(
      "approuvee",
    );

    const byEditor = await call<ApiErrorBody>("POST", "/newsletters/nl_current/export", {
      user: EDITOR,
    });
    expect(byEditor.status).toBe(403);
    const recorded = await call<NewsletterEdition>("POST", "/newsletters/nl_current/export", {
      user: VALIDATOR,
      body: { version: 8, revision: 4 },
    });
    expect(recorded.body.status).toBe("exportee");
    await call("POST", "/newsletters/nl_current/export", {
      user: VALIDATOR,
      body: { version: 8, revision: 4 },
    });
    const attempts = await call<PublicationAttempt[]>("GET", "/publications?channel=newsletter");
    expect(attempts.body.filter((p) => p.newsletterId === "nl_current")).toHaveLength(1);

    const locked = await call<ApiErrorBody>("PATCH", "/newsletters/nl_current", {
      body: { intro: "Nouveau", version: 8, revision: 5 },
      user: EDITOR,
    });
    expect(locked.status).toBe(409);
  });

  it("l'interrupteur « Inclure dans la prochaine édition » met à jour l'édition courante", async () => {
    const off = await call<Signal>("PATCH", "/signals/sig_pasqal", {
      body: { inNewsletter: false },
      user: EDITOR,
    });
    expect(off.body.inNewsletter).toBe(false);
    let dashboard = await call<Dashboard>("GET", "/dashboard");
    expect(dashboard.body.newsletter).toMatchObject({
      includeNext: false,
      selectedCount: 11,
      signalId: "sig_pasqal",
    });
    const on = await call<Signal>("PATCH", "/signals/sig_pasqal", {
      body: { inNewsletter: true },
      user: EDITOR,
    });
    expect(on.body.inNewsletter).toBe(true);
    dashboard = await call<Dashboard>("GET", "/dashboard");
    expect(dashboard.body.newsletter).toMatchObject({ includeNext: true, selectedCount: 12 });
  });

  it("refuse d'approuver une édition vide", async () => {
    const created = await call<NewsletterEdition>("POST", "/newsletters", {
      body: { title: "Édition spéciale" },
      user: EDITOR,
    });
    expect(created.status).toBe(201);
    const res = await call<ApiErrorBody>("POST", `/newsletters/${created.body.id}/approve`, {
      body: { version: 1, revision: 0 },
      user: VALIDATOR,
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("newsletter_empty");
  });
});

describe("recherche globale", () => {
  it("trouve entreprises, signaux et articles", async () => {
    const res = await call<SearchResult[]>("GET", "/search?q=pasqal");
    const kinds = new Set(res.body.map((r) => r.kind));
    expect(kinds).toEqual(new Set(["company", "signal", "article", "source"]));
    expect(res.body.find((r) => r.kind === "company")).toMatchObject({
      id: "co_pasqal",
      link: "/entreprises?id=co_pasqal",
    });
    expect((await call<SearchResult[]>("GET", "/search?q=p")).body).toEqual([]);
  });
});
