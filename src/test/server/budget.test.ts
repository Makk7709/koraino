import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  ApiErrorBody,
  Article,
  CollectionRun,
  Company,
  Dashboard,
  Notification,
  PublicationAttempt,
  Source,
  UsageSnapshot,
} from "@/lib/api/types";
import { setAdapters } from "@/server/adapters";
import { TemplateTextModel, type TextModel } from "@/server/adapters/text-model";
import { getRepository } from "@/server/store/memory";
import { call, NOW, setup, teardown, USERS } from "./helpers";

beforeEach(() => setup());
afterEach(teardown);

const meter = (u: UsageSnapshot, key: string) => u.meters.find((m) => m.key === key)!;

async function spend(
  costEur: number,
  kind: "search_query" | "generation_article" = "search_query",
  units = 0,
) {
  await (
    await getRepository()
  ).usage.insert({
    id: `use_test_${Math.random().toString(36).slice(2)}`,
    at: NOW.toISOString(),
    kind,
    units,
    costEur,
    label: "Consommation de test",
  });
}

/** Modèle de texte espion : compte les appels (aucun ne doit partir quand le budget est épuisé). */
function spyTextModel() {
  const inner = new TemplateTextModel();
  const calls: string[] = [];
  const model: TextModel = {
    name: "espion",
    generateDossier: (i) => (calls.push("generateDossier"), inner.generateDossier(i)),
    linkedinVariants: (i) => (calls.push("linkedinVariants"), inner.linkedinVariants(i)),
    summarize: (i) => (calls.push("summarize"), inner.summarize(i)),
    editorialNotes: (i) => inner.editorialNotes(i),
  };
  setAdapters({ textModel: model });
  return calls;
}

describe("consommation et quotas", () => {
  it("préserve les fractions de centime dans le total mensuel", async () => {
    const { monthTotals } = await import("@/server/domain/budget");
    const { monthKey } = await import("@/server/domain/dates");
    const records = [0.004, 0.004].map((costEur, index) => ({
      id: `micro_${index}`,
      at: NOW.toISOString(),
      kind: "generation_summary" as const,
      units: 1,
      costEur,
      label: "Microcoût",
    }));
    expect(monthTotals(records, monthKey(NOW)).costEur).toBe(0.008);
  });

  it("expose la consommation du mois (≈ 112 € sur 150 €)", async () => {
    const { body } = await call<UsageSnapshot>("GET", "/usage");
    expect(body.paidCallsSuspended).toBe(false);
    expect(meter(body, "api_budget_eur")).toMatchObject({ used: 112.4, limit: 150, alert: "ok" });
    expect(meter(body, "articles")).toMatchObject({ used: 14, limit: 25 });
    expect(meter(body, "linkedin_posts")).toMatchObject({ used: 9, limit: 25 });
    expect(meter(body, "companies")).toMatchObject({
      used: 150,
      limit: 150,
      alert: "atteint",
      ratio: 1,
    });
    expect(meter(body, "sources").limit).toBe(300);
    expect(meter(body, "storage_gb").limit).toBe(10);
  });

  it("budget épuisé : 402, appels payants suspendus sans appel, lecture et exports disponibles", async () => {
    await spend(37.4);
    const calls = spyTextModel();
    const articlesBefore = await call<Article[]>("GET", "/articles");

    const article = await call<ApiErrorBody>("POST", "/articles", {
      body: { signalId: "sig_verkor" },
      user: USERS.redacteur,
    });
    expect(article.status).toBe(402);
    expect(article.body.error.code).toBe("budget_exhausted");
    const post = await call<ApiErrorBody>("POST", "/linkedin", {
      body: { signalId: "sig_verkor" },
    });
    expect(post.status).toBe(402);
    const include = await call<ApiErrorBody>("PATCH", "/signals/sig_wattpark", {
      body: { inNewsletter: true },
    });
    expect(include.status).toBe(402);
    expect(calls).toEqual([]);

    const sources = await call<Source[]>("GET", "/sources?companyId=co_pasqal");
    const collect = await call<ApiErrorBody>("POST", `/sources/${sources.body[0]!.id}/collect`);
    expect(collect.status).toBe(402);
    const runs = await call<CollectionRun[]>(
      "GET",
      `/collection-runs?sourceId=${sources.body[0]!.id}&limit=1`,
    );
    expect(runs.body[0]).toMatchObject({ status: "bloque_quota", errorCode: "budget_exhausted" });

    const usage = await call<UsageSnapshot>("GET", "/usage");
    expect(usage.body.paidCallsSuspended).toBe(true);
    expect(meter(usage.body, "api_budget_eur").used).toBeCloseTo(149.8, 5);
    const articlesAfter = await call<Article[]>("GET", "/articles");
    expect(articlesAfter.body).toHaveLength(articlesBefore.body.length);

    // Lecture, exports et décisions non payantes restent disponibles.
    expect((await call("GET", "/signals?limit=5")).status).toBe(200);
    expect((await call("GET", "/articles/art_pasqal")).status).toBe(200);
    const dashboard = await call<Dashboard>("GET", "/dashboard");
    expect(dashboard.body.engine.active).toBe(false);
    const csv = await call("GET", "/export/signals?format=csv");
    expect(csv.status).toBe(200);
    expect((await call("GET", "/newsletters/nl_current/export?format=html")).status).toBe(200);
    const publish = await call<PublicationAttempt>("POST", "/articles/art_pasqal/publish", {
      body: { channel: "wordpress" },
      user: USERS.validateur,
    });
    expect(publish.status).toBe(201);

    const notifications = await call<Notification[]>("GET", "/notifications");
    expect(notifications.body.map((n) => n.title)).toContain(
      "Budget API : appels payants suspendus",
    );
  });

  it("réserve le coût estimé avant l'appel : refus si la réservation dépasserait le plafond", async () => {
    await spend(37.3); // 149,70 € : un article (0,45 €) dépasserait 150 €
    const calls = spyTextModel();
    const res = await call<ApiErrorBody>("POST", "/articles", {
      body: { signalId: "sig_verkor" },
      user: USERS.redacteur,
    });
    expect(res.status).toBe(402);
    expect(calls).toEqual([]);
  });

  it("alerte à 80 % du budget", async () => {
    await spend(8); // 120,40 € ≥ 80 %
    await call("POST", "/articles", { body: { signalId: "sig_verkor" }, user: USERS.redacteur });
    const usage = await call<UsageSnapshot>("GET", "/usage");
    expect(meter(usage.body, "api_budget_eur").alert).toBe("seuil_80");
    const notifications = await call<Notification[]>("GET", "/notifications");
    expect(notifications.body.some((n) => n.kind === "quota" && n.title.includes("80"))).toBe(true);
  });

  it("applique le quota d'articles du mois (25)", async () => {
    await spend(0, "generation_article", 11);
    const res = await call<ApiErrorBody>("POST", "/articles", {
      body: { signalId: "sig_verkor" },
      user: USERS.redacteur,
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("quota_exceeded");
  });

  it("applique le quota de 150 entreprises", async () => {
    const input = {
      name: "Chartreuse Instruments",
      domain: "chartreuse-instruments.fr",
      sector: "Instrumentation",
    };
    const full = await call<ApiErrorBody>("POST", "/companies", { body: input });
    expect(full.status).toBe(422);
    expect(full.body.error.code).toBe("quota_exceeded");

    const companies = await call<Company[]>("GET", "/companies");
    const victim = companies.body.find((c) => c.id !== "co_pasqal" && c.signalCount > 0)!;
    expect((await call("DELETE", `/companies/${victim.id}`)).status).toBe(204);
    const created = await call<Company>("POST", "/companies", {
      body: { ...input, themes: ["numerique"] },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: "Chartreuse Instruments",
      priority: "normale",
      sourceCount: 1,
    });
    const duplicate = await call<ApiErrorBody>("POST", "/companies", { body: input });
    expect(duplicate.status).toBe(422); // de nouveau plein : le quota est vérifié avant le doublon
  });
});
