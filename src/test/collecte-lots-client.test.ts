import { describe, expect, it, vi } from "vitest";
import { collectAllInBatches } from "@/components/veille/useCollect";
import type { CollectionBatch, CollectionRun } from "@/lib/api/types";

const run = (id: string): CollectionRun => ({
  id: `run_${id}`,
  sourceId: `src_${id}`,
  companyId: "co_x",
  startedAt: "2026-10-12T08:30:00.000Z",
  finishedAt: "2026-10-12T08:30:05.000Z",
  status: "succes_sans_actualite",
  newObservations: 0,
  errorCode: null,
  errorMessage: null,
});

describe("collecte globale côté client", () => {
  it("enchaîne les lots avec le même début jusqu'à épuisement et réunit les exécutions", async () => {
    const batches: CollectionBatch[] = [
      { since: "2026-10-12T08:30:00.000Z", total: 5, runs: [run("a"), run("b")], remaining: 3 },
      { since: "2026-10-12T08:30:00.000Z", total: 5, runs: [run("c"), run("d")], remaining: 1 },
      { since: "2026-10-12T08:30:00.000Z", total: 5, runs: [run("e")], remaining: 0 },
    ];
    const fetchBatch = vi.fn(async (_body: { since?: string }) => batches.shift()!);
    const progress: [number, number][] = [];
    const runs = await collectAllInBatches(fetchBatch, (done, total) =>
      progress.push([done, total]),
    );
    expect(runs.map((r) => r.id)).toEqual(["run_a", "run_b", "run_c", "run_d", "run_e"]);
    expect(fetchBatch.mock.calls.map(([body]) => body)).toEqual([
      {},
      { since: "2026-10-12T08:30:00.000Z" },
      { since: "2026-10-12T08:30:00.000Z" },
    ]);
    expect(progress).toEqual([
      [2, 5],
      [4, 5],
      [5, 5],
    ]);
  });

  it("s'arrête sur un lot vide même si le serveur annonce des sources restantes", async () => {
    const fetchBatch = vi.fn(async () => ({
      since: "2026-10-12T08:30:00.000Z",
      total: 5,
      runs: [],
      remaining: 5,
    }));
    expect(await collectAllInBatches(fetchBatch)).toEqual([]);
    expect(fetchBatch).toHaveBeenCalledTimes(1);
  });

  it("propage l'erreur d'un lot sans la masquer", async () => {
    const fetchBatch = vi.fn(async () => {
      throw new Error("collection_in_progress");
    });
    await expect(collectAllInBatches(fetchBatch)).rejects.toThrow("collection_in_progress");
  });
});
