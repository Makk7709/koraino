import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CollectionRun, HumanImport } from "@/lib/api/types";
import { COSTS, monthTotals } from "@/server/domain/budget";
import { monthKey } from "@/server/domain/dates";
import { getRepository } from "@/server/store/memory";
import { call, multipart, NOW, setup, teardown } from "./helpers";

const twice = <T>(fn: () => Promise<T>) => Promise.all([fn(), fn()]);
const statuses = (res: { status: number }[]) => res.map((r) => r.status).sort();

/** Signaux sans article, sans post LinkedIn, absents de l'édition en cours. */
async function freeSignals(n: number): Promise<string[]> {
  const repo = await getRepository();
  const [signals, posts, editions] = await Promise.all([
    repo.signals.list(),
    repo.linkedin.list(),
    repo.newsletters.list(),
  ]);
  const ids = signals
    .filter(
      (s) =>
        !s.articleId &&
        s.status !== "rejete" &&
        !posts.some((p) => p.signalId === s.id) &&
        !editions.some((e) => e.items.some((i) => i.signalId === s.id)),
    )
    .map((s) => s.id)
    .slice(0, n);
  expect(ids).toHaveLength(n);
  return ids;
}

beforeEach(() => {
  setup();
});
afterEach(teardown);

describe("deux demandes simultanées : une seule création", () => {
  it("post LinkedIn : une seule génération payante, un seul post", async () => {
    const repo = await getRepository();
    const [signalId] = await freeSignals(1);
    const usage = (await repo.usage.list()).length;
    const res = await twice(() => call("POST", "/linkedin", { body: { signalId } }));
    expect(statuses(res)).toEqual([201, 409]);
    expect((await repo.linkedin.list()).filter((p) => p.signalId === signalId)).toHaveLength(1);
    expect(await repo.usage.list()).toHaveLength(usage + 1);
  });

  it("article depuis un signal : une seule génération payante, un seul article", async () => {
    const repo = await getRepository();
    const [signalId] = await freeSignals(1);
    const usage = (await repo.usage.list()).length;
    const res = await twice(() => call("POST", "/articles", { body: { signalId } }));
    expect(statuses(res)).toEqual([201, 409]);
    expect((await repo.articles.list()).filter((a) => a.signalId === signalId)).toHaveLength(1);
    expect(await repo.usage.list()).toHaveLength(usage + 1);
  });

  it("newsletter : le même sujet n'est ajouté (et résumé) qu'une fois", async () => {
    const repo = await getRepository();
    const [signalId] = await freeSignals(1);
    const before = (await repo.newsletters.get("nl_current"))!.items.length;
    const res = await twice(() =>
      call("POST", "/newsletters/nl_current/items", {
        body: { signalId, version: 6, revision: 0 },
      }),
    );
    expect(statuses(res)).toEqual([201, 409]);
    expect((await repo.newsletters.get("nl_current"))!.items).toHaveLength(before + 1);
  });

  it("newsletter : deux ajouts obsolètes produisent un conflit puis une reprise explicite", async () => {
    const repo = await getRepository();
    const [a, b] = await freeSignals(2);
    const before = (await repo.newsletters.get("nl_current"))!.items.length;
    const res = await Promise.all(
      [a, b].map((signalId) =>
        call("POST", "/newsletters/nl_current/items", {
          body: { signalId, version: 6, revision: 0 },
        }),
      ),
    );
    expect(statuses(res)).toEqual([201, 409]);
    const current = (await repo.newsletters.get("nl_current"))!;
    const missing = [a, b].find((id) => !current.items.some((i) => i.signalId === id));
    const retry = await call("POST", "/newsletters/nl_current/items", {
      body: { signalId: missing, version: current.version, revision: current.revision ?? 0 },
    });
    expect(retry.status).toBe(201);
    const items = (await repo.newsletters.get("nl_current"))!.items;
    expect(items).toHaveLength(before + 2);
    expect(items.map((i) => i.signalId)).toEqual(expect.arrayContaining([a, b]));
  });

  it("sans édition en cours, deux inclusions simultanées n'en créent qu'une", async () => {
    const repo = await getRepository();
    for (const e of await repo.newsletters.list())
      await repo.newsletters.update({ ...e, status: "exportee" });
    const [a, b] = await freeSignals(2);
    const res = await Promise.all(
      [a, b].map((id) => call("PATCH", `/signals/${id}`, { body: { inNewsletter: true } })),
    );
    expect(statuses(res)).toEqual([200, 200]);
    const open = (await repo.newsletters.list()).filter((e) => e.status !== "exportee");
    expect(open).toHaveLength(1);
    expect(open[0]!.items.map((i) => i.signalId).sort()).toEqual([a, b].sort());
  });

  it("conversion d'import : un seul article", async () => {
    const repo = await getRepository();
    const imported = await call<HumanImport>("POST", "/imports", {
      raw: multipart(
        { author: "Camille Roux" },
        { name: "article.txt", type: "text/plain", content: "Titre\r\n\r\nChapô.\r\n\r\nCorps." },
      ),
    });
    expect(imported.status).toBe(201);
    const articles = (await repo.articles.list()).length;
    const res = await twice(() => call("POST", `/imports/${imported.body.id}/convert`));
    expect(statuses(res)).toEqual([201, 409]);
    expect(await repo.articles.list()).toHaveLength(articles + 1);
  });

  it("proposition de règle : acceptée une seule fois", async () => {
    const repo = await getRepository();
    const proposal = (await repo.ruleProposals.list()).find((p) => p.status === "proposee");
    expect(proposal).toBeDefined();
    const weight = async () => (await repo.rules.list()).reduce((s, r) => s + r.version, 0);
    const before = await weight();
    const res = await twice(() =>
      call("PATCH", `/editorial-dna/proposals/${proposal!.id}`, {
        body: { decision: "acceptee" },
      }),
    );
    expect(statuses(res)).toEqual([200, 409]);
    expect(await weight()).toBe(before + 1);
  });

  it("plafond de budget : deux appels payants simultanés ne le dépassent pas", async () => {
    const repo = await getRepository();
    const settings = await repo.getSettings();
    const spent = monthTotals(await repo.usage.list(), monthKey(NOW)).costEur;
    settings.quotaLimits.api_budget_eur = spent + COSTS.linkedin * 1.5;
    await repo.saveSettings(settings);
    const [a, b] = await freeSignals(2);
    const res = await Promise.all(
      [a, b].map((signalId) => call("POST", "/linkedin", { body: { signalId } })),
    );
    expect(statuses(res)).toEqual([201, 402]);
    expect((await repo.getSettings()).reservedEur).toBe(0);
  });

  it("budget occupé trop longtemps : seule l'exécution de la source échoue, sans la marquer en erreur", async () => {
    const repo = await getRepository();
    const source = (await repo.sources.list()).find((s) => s.access === "ok")!;
    await repo.acquireLock("budget", 60_000);
    const res = await call<CollectionRun>("POST", `/sources/${source.id}/collect`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "echec", errorCode: "budget_busy" });
    expect((await repo.sources.get(source.id))!.access).toBe("ok");
  }, 10_000);
});
