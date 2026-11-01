import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { COSTS } from "@/server/domain/budget";
import { paidCall } from "@/server/services/usage";
import { getRepository } from "@/server/store/memory";
import { NOW, setup, teardown, USERS } from "./helpers";

describe("KORA A3 / P1-11 — tentatives payantes", () => {
  beforeEach(() => setup());
  afterEach(teardown);

  const ctx = async () => ({
    repo: await getRepository(), now: NOW,
    user: { id: USERS.redacteur } as never,
  });

  it("journalise une tentative et libère la réserve uniquement après enregistrement", async () => {
    const c = await ctx();
    const old = (await c.repo.usage.list()).length;
    const result = await paidCall(c, {
      kind: "generation_summary", estimate: COSTS.summary, units: 1,
      label: "Résumé test A3",
    }, async () => "ok");
    expect(result).toBe("ok");
    const entries = (await c.repo.usage.list()).slice(old);
    expect(entries).toHaveLength(1);
    const attemptId = entries[0]!.id.split(":line:")[0]!;
    expect(await c.repo.paidAttempts.get(attemptId)).toMatchObject({
      status: "settled", billingStatus: "estimate_unverified",
      estimateEur: COSTS.summary,
    });
    expect((await c.repo.getSettings()).reservedEur).toBe(0);
  });

  it("conserve l'exposition et marque unknown si la fonction payante échoue", async () => {
    const c = await ctx();
    const before = (await c.repo.usage.list()).length;
    await expect(paidCall(c, {
      kind: "generation_summary", estimate: COSTS.summary, units: 1,
      label: "Échec fournisseur simulé",
    }, async () => { throw new Error("timeout"); })).rejects.toThrow("timeout");
    expect((await c.repo.usage.list()).length).toBe(before);
    expect((await c.repo.getSettings()).reservedEur).toBeCloseTo(COSTS.summary);
    // Existing pending exposure blocks further calls near the limit.
    const settings = await c.repo.getSettings();
    const { monthTotals } = await import("@/server/domain/budget");
    const { monthKey } = await import("@/server/domain/dates");
    const spent = monthTotals(await c.repo.usage.list(), monthKey(NOW)).costEur;
    settings.quotaLimits.api_budget_eur = spent + COSTS.summary * 1.5;
    await c.repo.saveSettings(settings);
    let invoked = false;
    await expect(paidCall(c, {
      kind: "generation_summary", estimate: COSTS.summary, units: 1,
      label: "Appel interdit par exposition inconnue",
    }, async () => { invoked = true; return "no"; })).rejects.toMatchObject({
      code: "budget_exhausted",
    });
    expect(invoked).toBe(false);
  });

  it("une finalisation rejouée ne recompte pas l'usage ni la libération", async () => {
    const c = await ctx();
    const id = c.repo.nextId("pat");
    const { monthKey } = await import("@/server/domain/dates");
    expect(await c.repo.paidAttempts.reserve({
      id, workspaceId: c.repo.workspaceId, month: monthKey(NOW),
      kind: "generation_summary", estimateEur: COSTS.summary, units: 1,
      label: "Replay", createdAt: NOW.toISOString(),
    })).toEqual({ ok: true });
    await c.repo.paidAttempts.start(id);
    const line = {
      id: `${id}:line:0`, at: NOW.toISOString(),
      kind: "generation_summary" as const, units: 1,
      costEur: COSTS.summary, label: "Replay",
    };
    const old = (await c.repo.usage.list()).length;
    await c.repo.paidAttempts.finish(id, [line], "settled");
    await c.repo.paidAttempts.finish(id, [line], "settled");
    expect((await c.repo.usage.list()).length).toBe(old + 1);
    expect((await c.repo.getSettings()).reservedEur).toBe(0);
    await expect(c.repo.paidAttempts.finish(id, [{ ...line, costEur: 0.01 }], "settled"))
      .rejects.toThrow("Paid attempt replay conflict");
  });

  it("un appel jamais envoyé peut être libéré explicitement avec preuve", async () => {
    const c = await ctx();
    const id = c.repo.nextId("pat");
    const { monthKey } = await import("@/server/domain/dates");
    await c.repo.paidAttempts.reserve({
      id, workspaceId: c.repo.workspaceId, month: monthKey(NOW),
      kind: "generation_summary", estimateEur: COSTS.summary, units: 1,
      label: "Never sent", createdAt: NOW.toISOString(),
    });
    await c.repo.paidAttempts.finish(id, [], "not_sent");
    expect(await c.repo.paidAttempts.get(id)).toMatchObject({
      status: "not_sent", billingStatus: "not_charged",
    });
    expect((await c.repo.getSettings()).reservedEur).toBe(0);
  });

  it("ne lance aucune fonction payante si la réservation est refusée", async () => {
    const c = await ctx();
    const { monthTotals } = await import("@/server/domain/budget");
    const { monthKey } = await import("@/server/domain/dates");
    const settings = await c.repo.getSettings();
    settings.quotaLimits.api_budget_eur = monthTotals(
      await c.repo.usage.list(), monthKey(NOW),
    ).costEur;
    await c.repo.saveSettings(settings);
    let invoked = false;
    await expect(paidCall(c, {
      kind: "generation_summary", estimate: COSTS.summary, units: 1, label: "Refus",
    }, async () => { invoked = true; return "should not happen"; })).rejects.toMatchObject({
      code: "budget_exhausted",
    });
    expect(invoked).toBe(false);
  });
  it("ne lance pas le fournisseur si start échoue avant la transition et libère not_sent", async () => {
    const c = await ctx();
    const originalStart = c.repo.paidAttempts.start;
    let invoked = false;
    c.repo.paidAttempts.start = async () => { throw new Error("start RPC unavailable"); };
    try {
      await expect(paidCall(c, {
        kind: "generation_summary", estimate: COSTS.summary, units: 1, label: "Start refused",
      }, async () => { invoked = true; return "unexpected"; })).rejects.toThrow("start RPC unavailable");
      expect(invoked).toBe(false);
      expect((await c.repo.getSettings()).reservedEur).toBe(0);
    } finally {
      c.repo.paidAttempts.start = originalStart;
    }
  });

  it("conserve l'exposition si start a commité mais son accusé est perdu", async () => {
    const c = await ctx();
    const originalStart = c.repo.paidAttempts.start;
    let invoked = false;
    c.repo.paidAttempts.start = async (id) => {
      await originalStart(id);
      throw new Error("start acknowledgement lost");
    };
    try {
      await expect(paidCall(c, {
        kind: "generation_summary", estimate: COSTS.summary, units: 1, label: "Lost start ack",
      }, async () => { invoked = true; return "unexpected"; })).rejects.toThrow("start acknowledgement lost");
      expect(invoked).toBe(false);
      expect((await c.repo.getSettings()).reservedEur).toBeCloseTo(COSTS.summary);
    } finally {
      c.repo.paidAttempts.start = originalStart;
    }
  });

  it("conserve la réserve en l'absence de lecture fiable après l'échec de start", async () => {
    const c = await ctx();
    const originalStart = c.repo.paidAttempts.start;
    const originalGet = c.repo.paidAttempts.get;
    let invoked = false;
    c.repo.paidAttempts.start = async () => { throw new Error("start uncertain"); };
    c.repo.paidAttempts.get = async () => { throw new Error("read unavailable"); };
    try {
      await expect(paidCall(c, {
        kind: "generation_summary", estimate: COSTS.summary, units: 1, label: "Unknown start state",
      }, async () => { invoked = true; return "unexpected"; })).rejects.toThrow("start uncertain");
      expect(invoked).toBe(false);
      expect((await c.repo.getSettings()).reservedEur).toBeCloseTo(COSTS.summary);
    } finally {
      c.repo.paidAttempts.start = originalStart;
      c.repo.paidAttempts.get = originalGet;
    }
  });

});
