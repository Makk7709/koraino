import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CollectionBatch, CollectionRun, Source } from "@/lib/api/types";
import { setAdapters } from "@/server/adapters";
import type { CollectInput, CollectResult } from "@/server/adapters/collector";
import { monthTotals } from "@/server/domain/budget";
import { monthKey } from "@/server/domain/dates";
import { BATCH_SIZE, MAX_ITEMS, parallel } from "@/server/services/collection";
import { getRepository } from "@/server/store/memory";
import { call, NOW, setup, teardown } from "./helpers";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Collecteur qui compte les appels simultanés et répond après un court délai. */
function slowCollector(result: (input: CollectInput) => CollectResult, delayMs = 20) {
  const state = { inFlight: 0, peak: 0, calls: 0 };
  setAdapters({
    collector: {
      name: "lent",
      async collect(input) {
        state.calls += 1;
        state.inFlight += 1;
        state.peak = Math.max(state.peak, state.inFlight);
        await sleep(delayMs);
        state.inFlight -= 1;
        return result(input);
      },
    },
  });
  return state;
}

async function activeSources(): Promise<Source[]> {
  return (await call<Source[]>("GET", "/sources")).body.filter((s) => s.access !== "desactivee");
}

async function wholeCollection(limit?: number): Promise<CollectionRun[]> {
  const runs: CollectionRun[] = [];
  let since: string | undefined;
  for (let i = 0; i < 100; i++) {
    const batch = await call<CollectionBatch>("POST", "/collect", {
      body: { ...(since ? { since } : {}), ...(limit ? { limit } : {}) },
    });
    expect(batch.status).toBe(200);
    since = batch.body.since;
    runs.push(...batch.body.runs);
    if (batch.body.remaining === 0) break;
  }
  return runs;
}

describe("parallel", () => {
  it("borne la concurrence et conserve l'ordre des résultats", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await parallel([30, 5, 20, 1, 10], 2, async (ms) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await sleep(ms);
      inFlight -= 1;
      return ms * 2;
    });
    expect(out).toEqual([60, 10, 40, 2, 20]);
    expect(peak).toBe(2);
    expect(await parallel([], 3, async () => 1)).toEqual([]);
  });
});

describe("collecte globale par lots", () => {
  beforeEach(() => setup());
  afterEach(teardown);

  it("lit les sources d'un lot en parallèle et les ingère toutes", async () => {
    const state = slowCollector(() => ({ ok: true, items: [] }));
    const first = await call<CollectionBatch>("POST", "/collect");
    expect(first.body.runs).toHaveLength(BATCH_SIZE);
    expect(state.calls).toBe(BATCH_SIZE);
    expect(state.peak).toBeGreaterThan(1);
    expect(first.body.runs.every((r) => r.status === "succes_sans_actualite")).toBe(true);
  });

  it("commence par les sources jamais collectées, puis les plus anciennes", async () => {
    slowCollector(() => ({ ok: true, items: [] }), 0);
    const sources = await activeSources();
    const never = sources.filter((s) => s.lastRunAt === null).map((s) => s.id);
    const first = await call<CollectionBatch>("POST", "/collect", { body: { limit: 3 } });
    const picked = first.body.runs.map((r) => r.sourceId);
    if (never.length >= 3) expect(picked.every((id) => never.includes(id))).toBe(true);
    const byAge = sources
      .filter((s) => !picked.includes(s.id) && s.lastRunAt !== null)
      .sort((a, b) => a.lastRunAt!.localeCompare(b.lastRunAt!));
    const second = await call<CollectionBatch>("POST", "/collect", {
      body: { since: first.body.since, limit: 3 },
    });
    const remainingNever = never.filter((id) => !picked.includes(id));
    const expected = [...remainingNever, ...byAge.map((s) => s.id)].slice(0, 3);
    expect(second.body.runs.map((r) => r.sourceId).sort()).toEqual([...expected].sort());
  });

  it("réserve le budget une fois par lot et consigne les volumes par source, sans coût pour un flux", async () => {
    const repo = await getRepository();
    const month = monthKey(NOW);
    const before = monthTotals(await repo.usage.list(), month);
    slowCollector(
      (input) =>
        input.source.id.endsWith("1")
          ? {
              ok: true,
              items: [
                {
                  url: `https://www.placegrenet.fr/${input.source.id}`,
                  title: `${input.company?.name ?? "Entreprise"} annonce un partenariat`,
                  html: `<p>${input.company?.name ?? "Entreprise"} annonce un partenariat industriel.</p>`,
                  outlet: {
                    name: "Place Gre'net",
                    domain: "placegrenet.fr",
                    brand: { initials: "P", bg: "#111", fg: "#fff" },
                  },
                  publishedAt: NOW.toISOString(),
                  eventDate: null,
                },
              ],
            }
          : { ok: true, items: [] },
      0,
    );
    const entriesBefore = (await repo.usage.list()).length;
    const batch = await call<CollectionBatch>("POST", "/collect", { body: { limit: 5 } });
    const created = batch.body.runs.reduce((s, r) => s + r.newObservations, 0);
    expect(created).toBeGreaterThan(0);
    const entries = (await repo.usage.list()).slice(entriesBefore);
    const after = monthTotals(await repo.usage.list(), month);
    expect(after.units.search_queries - before.units.search_queries).toBe(5);
    expect(after.units.observations - before.units.observations).toBe(created);
    // Lire un flux est gratuit : les volumes sont comptés, aucun euro n'est imputé.
    expect(entries.reduce((s, u) => s + u.costEur, 0)).toBe(0);
    expect((await repo.getSettings()).reservedEur).toBe(0);
    const labels = entries.map((u) => u.label);
    for (const run of batch.body.runs) {
      const source = (await repo.sources.get(run.sourceId))!;
      expect(labels).toContain(`Collecte ${source.label}`);
    }
  });

  it("au plafond budgétaire, bloque le lot et les sources restantes, puis s'arrête", async () => {
    const repo = await getRepository();
    const settings = await repo.getSettings();
    settings.quotaLimits.api_budget_eur = monthTotals(
      await repo.usage.list(),
      monthKey(NOW),
    ).costEur;
    await repo.saveSettings(settings);
    const state = slowCollector(() => ({ ok: true, items: [] }), 0);
    const total = (await activeSources()).length;
    const batch = await call<CollectionBatch>("POST", "/collect");
    expect(batch.status).toBe(200);
    expect(state.calls).toBe(0);
    expect(batch.body.runs).toHaveLength(total);
    expect(batch.body.runs.every((r) => r.status === "bloque_quota")).toBe(true);
    expect(batch.body.remaining).toBe(0);
  });

  it("verrou budget occupé : le lot est consigné en échec sans toucher aux sources, et la collecte continue", async () => {
    const repo = await getRepository();
    const state = slowCollector(() => ({ ok: true, items: [] }), 0);
    const token = await repo.acquireLock("budget", 60_000);
    const first = await call<CollectionBatch>("POST", "/collect", { body: { limit: 3 } });
    expect(first.status).toBe(200);
    expect(state.calls).toBe(0);
    expect(first.body.runs.map((r) => r.errorCode)).toEqual([
      "budget_busy",
      "budget_busy",
      "budget_busy",
    ]);
    for (const run of first.body.runs) {
      const source = (await repo.sources.get(run.sourceId))!;
      expect(source.access).not.toBe("erreur");
      expect(source.lastRunAt).toBe(NOW.toISOString());
    }
    await repo.releaseLock("budget", token!);
    const second = await call<CollectionBatch>("POST", "/collect", {
      body: { since: first.body.since, limit: 3 },
    });
    expect(second.body.remaining).toBe(first.body.remaining - 3);
    expect(second.body.runs.every((r) => r.status === "succes_sans_actualite")).toBe(true);
  }, 15_000);

  it("une collecte complète couvre chaque source active exactement une fois", async () => {
    slowCollector(() => ({ ok: true, items: [] }), 0);
    const sources = await activeSources();
    const runs = await wholeCollection(25);
    expect(runs.map((r) => r.sourceId).sort()).toEqual(sources.map((s) => s.id).sort());
    expect(MAX_ITEMS).toBe(5);
  });
});
