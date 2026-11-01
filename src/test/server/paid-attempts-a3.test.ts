import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { COSTS } from "@/server/domain/budget";
import { paidCall } from "@/server/services/usage";
import { getRepository } from "@/server/store/memory";
import { NOW, setup, teardown, USERS } from "./helpers";

describe("KORA A3 / P1-11 — tentatives payantes", () => {
  beforeEach(() => setup());
  afterEach(teardown);

  const ctx = async () => ({
    repo: await getRepository(),
    now: NOW,
    user: { id: USERS.redacteur } as never,
  });

  it("journalise une tentative et libère la réserve uniquement après enregistrement", async () => {
    const c = await ctx();
    const old = (await c.repo.usage.list()).length;
    const result = await paidCall(
      c,
      {
        kind: "generation_summary",
        estimate: COSTS.summary,
        units: 1,
        label: "Résumé test A3",
      },
      async () => "ok",
    );
    expect(result).toBe("ok");
    const entries = (await c.repo.usage.list()).slice(old);
    expect(entries).toHaveLength(1);
    const attemptId = entries[0]!.id.split(":line:")[0]!;
    expect(await c.repo.paidAttempts.get(attemptId)).toMatchObject({
      status: "settled",
      billingStatus: "estimate_unverified",
      estimateEur: COSTS.summary,
    });
    expect((await c.repo.getSettings()).reservedEur).toBe(0);
  });

  it("conserve l'exposition et marque unknown si la fonction payante échoue", async () => {
    const c = await ctx();
    const before = (await c.repo.usage.list()).length;
    await expect(
      paidCall(
        c,
        {
          kind: "generation_summary",
          estimate: COSTS.summary,
          units: 1,
          label: "Échec fournisseur simulé",
        },
        async () => {
          throw new Error("timeout");
        },
      ),
    ).rejects.toThrow("timeout");
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
    await expect(
      paidCall(
        c,
        {
          kind: "generation_summary",
          estimate: COSTS.summary,
          units: 1,
          label: "Appel interdit par exposition inconnue",
        },
        async () => {
          invoked = true;
          return "no";
        },
      ),
    ).rejects.toMatchObject({
      code: "budget_exhausted",
    });
    expect(invoked).toBe(false);
  });

  it("une finalisation rejouée ne recompte pas l'usage ni la libération", async () => {
    const c = await ctx();
    const id = c.repo.nextId("pat");
    const { monthKey } = await import("@/server/domain/dates");
    expect(
      await c.repo.paidAttempts.reserve({
        id,
        workspaceId: c.repo.workspaceId,
        month: monthKey(NOW),
        kind: "generation_summary",
        estimateEur: COSTS.summary,
        units: 1,
        label: "Replay",
        createdAt: NOW.toISOString(),
      }),
    ).toEqual({ ok: true });
    await c.repo.paidAttempts.start(id);
    const line = {
      id: `${id}:line:0`,
      at: NOW.toISOString(),
      kind: "generation_summary" as const,
      units: 1,
      costEur: COSTS.summary,
      label: "Replay",
    };
    const old = (await c.repo.usage.list()).length;
    await c.repo.paidAttempts.finish(id, [line], "settled");
    await c.repo.paidAttempts.finish(id, [line], "settled");
    expect((await c.repo.usage.list()).length).toBe(old + 1);
    expect((await c.repo.getSettings()).reservedEur).toBe(0);
    await expect(
      c.repo.paidAttempts.finish(id, [{ ...line, costEur: 0.01 }], "settled"),
    ).rejects.toThrow("Paid attempt replay conflict");
  });

  it("récupère la finalisation lorsque son accusé est perdu et que le ledger correspond", async () => {
    const c = await ctx();
    const originalFinish = c.repo.paidAttempts.finish;
    let supplierCalls = 0;
    c.repo.paidAttempts.finish = async (id, lines, status) => {
      await originalFinish(id, lines, status);
      throw new Error("finish acknowledgement lost");
    };
    try {
      const value = await paidCall(
        c,
        { kind: "generation_summary", estimate: 0.02, units: 1, label: "Lost finish ACK" },
        async () => {
          supplierCalls++;
          return "provider result";
        },
      );
      expect(value).toBe("provider result");
      expect(supplierCalls).toBe(1);
      expect(await c.repo.paidAttempts.get("pat_n1001")).toMatchObject({ status: "settled" });
      expect((await c.repo.getSettings()).reservedEur).toBe(0);
      expect((await c.repo.usage.list()).filter((v) => v.id === "pat_n1001:line:0")).toHaveLength(1);
    } finally {
      c.repo.paidAttempts.finish = originalFinish;
    }
  });

  it("refuse une fausse confirmation de finalisation si le ledger diffère", async () => {
    const c = await ctx();
    const originalFinish = c.repo.paidAttempts.finish;
    c.repo.paidAttempts.finish = async (id, lines) => {
      await originalFinish(id, [{ ...lines[0]!, label: "Different committed ledger" }], "settled");
      throw new Error("settled but contradictory ledger");
    };
    try {
      await expect(
        paidCall(
          c,
          { kind: "generation_summary", estimate: 0.02, units: 1, label: "Contradictory" },
          async () => "result",
        ),
      ).rejects.toThrow("settled but contradictory ledger");
      expect(await c.repo.paidAttempts.get("pat_n1001")).toMatchObject({ status: "settled" });
    } finally {
      c.repo.paidAttempts.finish = originalFinish;
    }
  });

  it("refuse la réserve de précision supérieure à quatre décimales avant appel fournisseur", async () => {
    const c = await ctx();
    let invoked = false;
    await expect(
      paidCall(
        c,
        { kind: "generation_summary", estimate: 0.02001, units: 1, label: "Invalid reserve" },
        async () => {
          invoked = true;
          return "unexpected";
        },
      ),
    ).rejects.toThrow("Invalid paid attempt estimate precision");
    expect(invoked).toBe(false);
    expect((await c.repo.getSettings()).reservedEur).toBe(0);
    await expect(
      c.repo.paidAttempts.reserve({
        id: "pat_invalid",
        workspaceId: c.repo.workspaceId,
        month: NOW.toISOString().slice(0, 7),
        kind: "generation_summary",
        estimateEur: 0.02001,
        units: 1,
        label: "Invalid direct reserve",
        createdAt: NOW.toISOString(),
      }),
    ).rejects.toThrow();
  });

  it("ne modifie pas le motif estimated_overrun sur rejeu unknown contradictoire", async () => {
    const c = await ctx();
    await paidCall(
      c,
      { kind: "generation_summary", estimate: 0.02, units: 1, label: "Overrun immutable" },
      async () => "ok",
      () => [{ kind: "generation_summary", units: 1, costEur: 0.03, label: "Overrun" }],
    );
    await expect(c.repo.paidAttempts.unknown("pat_n1001", "persist_error")).rejects.toThrow(
      "Conflicting unknown-state replay",
    );
    expect(await c.repo.paidAttempts.get("pat_n1001")).toMatchObject({
      status: "unknown",
      failureCode: "estimated_overrun",
      estimatedCostEur: 0.03,
    });
  });

  it("un appel jamais envoyé peut être libéré explicitement avec preuve", async () => {
    const c = await ctx();
    const id = c.repo.nextId("pat");
    const { monthKey } = await import("@/server/domain/dates");
    await c.repo.paidAttempts.reserve({
      id,
      workspaceId: c.repo.workspaceId,
      month: monthKey(NOW),
      kind: "generation_summary",
      estimateEur: COSTS.summary,
      units: 1,
      label: "Never sent",
      createdAt: NOW.toISOString(),
    });
    await c.repo.paidAttempts.finish(id, [], "not_sent");
    expect(await c.repo.paidAttempts.get(id)).toMatchObject({
      status: "not_sent",
      billingStatus: "not_charged",
    });
    expect((await c.repo.getSettings()).reservedEur).toBe(0);
  });

  it("ne lance aucune fonction payante si la réservation est refusée", async () => {
    const c = await ctx();
    const { monthTotals } = await import("@/server/domain/budget");
    const { monthKey } = await import("@/server/domain/dates");
    const settings = await c.repo.getSettings();
    settings.quotaLimits.api_budget_eur = monthTotals(
      await c.repo.usage.list(),
      monthKey(NOW),
    ).costEur;
    await c.repo.saveSettings(settings);
    let invoked = false;
    await expect(
      paidCall(
        c,
        {
          kind: "generation_summary",
          estimate: COSTS.summary,
          units: 1,
          label: "Refus",
        },
        async () => {
          invoked = true;
          return "should not happen";
        },
      ),
    ).rejects.toMatchObject({
      code: "budget_exhausted",
    });
    expect(invoked).toBe(false);
  });
  it("ne lance pas le fournisseur si start échoue avant la transition et libère not_sent", async () => {
    const c = await ctx();
    const originalStart = c.repo.paidAttempts.start;
    let invoked = false;
    c.repo.paidAttempts.start = async () => {
      throw new Error("start RPC unavailable");
    };
    try {
      await expect(
        paidCall(
          c,
          {
            kind: "generation_summary",
            estimate: COSTS.summary,
            units: 1,
            label: "Start refused",
          },
          async () => {
            invoked = true;
            return "unexpected";
          },
        ),
      ).rejects.toThrow("start RPC unavailable");
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
      await expect(
        paidCall(
          c,
          {
            kind: "generation_summary",
            estimate: COSTS.summary,
            units: 1,
            label: "Lost start ack",
          },
          async () => {
            invoked = true;
            return "unexpected";
          },
        ),
      ).rejects.toThrow("start acknowledgement lost");
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
    c.repo.paidAttempts.start = async () => {
      throw new Error("start uncertain");
    };
    c.repo.paidAttempts.get = async () => {
      throw new Error("read unavailable");
    };
    try {
      await expect(
        paidCall(
          c,
          {
            kind: "generation_summary",
            estimate: COSTS.summary,
            units: 1,
            label: "Unknown start state",
          },
          async () => {
            invoked = true;
            return "unexpected";
          },
        ),
      ).rejects.toThrow("start uncertain");
      expect(invoked).toBe(false);
      expect((await c.repo.getSettings()).reservedEur).toBeCloseTo(COSTS.summary);
    } finally {
      c.repo.paidAttempts.start = originalStart;
      c.repo.paidAttempts.get = originalGet;
    }
  });

  it("retient la réserve et renvoie le résultat si un secours suit un coût incertain", async () => {
    const c = await ctx();
    const before = (await c.repo.usage.list()).length;
    const result = await paidCall(
      c,
      { kind: "generation_summary", estimate: COSTS.summary, units: 1, label: "Fallback usable" },
      async () => ({ text: "repli valide", billingUncertain: true }),
      undefined,
      (value) => value.billingUncertain,
    );
    expect(result.text).toBe("repli valide");
    expect((await c.repo.usage.list()).length).toBe(before);
    expect((await c.repo.getSettings()).reservedEur).toBeCloseTo(COSTS.summary);
  });

  it("refuse une précision coût supérieure à quatre décimales sans tronquer", async () => {
    const c = await ctx();
    const before = (await c.repo.usage.list()).length;
    await expect(
      paidCall(
        c,
        { kind: "generation_summary", estimate: 0.02, units: 1, label: "Précision" },
        async () => "ok",
        () => [{ kind: "generation_summary", costEur: 0.01999, units: 1, label: "Too precise" }],
      ),
    ).rejects.toThrow("Invalid usage cost precision");
    expect((await c.repo.usage.list()).length).toBe(before);
    expect((await c.repo.getSettings()).reservedEur).toBeCloseTo(0.02);
    expect(await c.repo.paidAttempts.get("pat_n1001")).toMatchObject({ status: "unknown" });
  });

  it("conserve la réserve si le détecteur de facturation incertaine échoue", async () => {
    const c = await ctx();
    await expect(
      paidCall(
        c,
        { kind: "generation_summary", estimate: 0.02, units: 1, label: "Predicate failure" },
        async () => "ok",
        undefined,
        () => {
          throw new Error("billing predicate unavailable");
        },
      ),
    ).rejects.toThrow("billing predicate unavailable");
    expect((await c.repo.getSettings()).reservedEur).toBeCloseTo(0.02);
    expect(await c.repo.paidAttempts.get("pat_n1001")).toMatchObject({ status: "unknown" });
  });

  it("ne remplace pas le motif de dépassement si l'accusé de persistance est perdu", async () => {
    const c = await ctx();
    const originalOverrun = c.repo.paidAttempts.overrun;
    c.repo.paidAttempts.overrun = async (id, lines) => {
      await originalOverrun(id, lines);
      throw new Error("overrun ACK lost");
    };
    try {
      await expect(
        paidCall(
          c,
          { kind: "generation_summary", estimate: 0.02, units: 1, label: "Overrun lost ACK" },
          async () => "ok",
          () => [{ kind: "generation_summary", costEur: 0.03, units: 1, label: "Overrun" }],
        ),
      ).rejects.toThrow("overrun ACK lost");
      expect(await c.repo.paidAttempts.get("pat_n1001")).toMatchObject({
        status: "unknown",
        failureCode: "estimated_overrun",
        estimatedCostEur: 0.03,
      });
      expect((await c.repo.getSettings()).reservedEur).toBeCloseTo(0.02);
    } finally {
      c.repo.paidAttempts.overrun = originalOverrun;
    }
  });

  it("persiste un dépassement estimatif intégral et conserve la réserve sans usage", async () => {
    const c = await ctx();
    const before = (await c.repo.usage.list()).length;
    const result = await paidCall(
      c,
      { kind: "generation_summary", estimate: 0.02, units: 1, label: "Overrun test" },
      async () => "result available",
      () => [{ kind: "generation_summary", costEur: 0.03, units: 1, label: "Estimate 0.03" }],
    );
    expect(result).toBe("result available");
    expect((await c.repo.usage.list()).length).toBe(before);
    expect((await c.repo.getSettings()).reservedEur).toBeCloseTo(0.02);
    // The reservation is held and the estimate is persisted, not silently clipped.
    const attempted = await c.repo.paidAttempts.get("pat_n1001");
    expect(attempted).toMatchObject({
      status: "unknown",
      failureCode: "estimated_overrun",
      estimateEur: 0.02,
      estimatedCostEur: 0.03,
      estimatedOverrunEur: 0.01,
    });
    expect(attempted?.estimatedUsageLines?.[0]?.costEur).toBe(0.03);
  });

  it("persiste les coûts inférieurs à la réserve sans troncature", async () => {
    const c = await ctx();
    const before = (await c.repo.usage.list()).length;
    await paidCall(
      c,
      { kind: "generation_summary", estimate: 0.02, units: 1, label: "Under reserve" },
      async () => "ok",
      () => [{ kind: "generation_summary", costEur: 0.015, units: 1, label: "Estimate 0.015" }],
    );
    const newLines = (await c.repo.usage.list()).slice(before);
    expect(newLines).toHaveLength(1);
    expect(newLines[0]!.costEur).toBe(0.015);
    expect((await c.repo.getSettings()).reservedEur).toBe(0);
  });

  it("n'accepte ni rejeu contradictoire ni écriture de dépassement sur settled", async () => {
    const c = await ctx();
    const { monthKey } = await import("@/server/domain/dates");
    const id = c.repo.nextId("pat");
    await c.repo.paidAttempts.reserve({
      id,
      workspaceId: c.repo.workspaceId,
      month: monthKey(NOW),
      kind: "generation_summary",
      estimateEur: 0.02,
      units: 1,
      label: "Replay overrun",
      createdAt: NOW.toISOString(),
    });
    await c.repo.paidAttempts.start(id);
    const lines = [
      {
        id: `${id}:line:0`,
        at: NOW.toISOString(),
        kind: "generation_summary" as const,
        units: 1,
        costEur: 0.03,
        label: "Replay",
      },
    ];
    await c.repo.paidAttempts.overrun(id, lines);
    await c.repo.paidAttempts.overrun(id, lines);
    expect((await c.repo.getSettings()).reservedEur).toBeCloseTo(0.02);
    await expect(
      c.repo.paidAttempts.overrun(id, [{ ...lines[0]!, costEur: 0.04 }]),
    ).rejects.toThrow();
  });
});
