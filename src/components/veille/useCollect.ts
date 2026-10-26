import { toast } from "sonner";
import { RUN_STATUS } from "@/components/kora/labels";
import { api } from "@/lib/api/client";
import { useKoraMutation } from "@/lib/api/hooks";
import type { CollectionBatch, CollectionRun } from "@/lib/api/types";
import { plural } from "./kit";
import { summarizeRuns } from "./runs";

/** Bilan d'une collecte unitaire : un échec reste un échec, jamais « aucune actualité ». */
function toastRun(run: CollectionRun) {
  switch (run.status) {
    case "succes":
      toast.success("Collecte réussie", {
        description: plural(run.newObservations, "nouvelle observation", "nouvelles observations"),
      });
      break;
    case "succes_sans_actualite":
      toast.success(RUN_STATUS.succes_sans_actualite.label, {
        description: "Source joignable, aucune nouvelle actualité publiée.",
      });
      break;
    case "bloque_quota":
      toast.warning("Collecte bloquée par le quota", {
        description:
          run.errorMessage ?? "Les appels payants sont suspendus jusqu'au mois prochain.",
      });
      break;
    case "echec":
      toast.error(`Échec de collecte${run.errorCode ? ` · ${run.errorCode}` : ""}`, {
        description: run.errorMessage ?? "La source n'a pas pu être consultée.",
      });
      break;
  }
}

export function useCollectSource() {
  return useKoraMutation((id: string) => api.collectSource(id), { onSuccess: toastRun });
}

const PROGRESS_TOAST = "collecte-globale";
/** Garde-fou : jamais plus de lots que de sources possibles (quota de 300 sources, lots de 8). */
const MAX_BATCHES = 60;

/**
 * Collecte globale par lots : chaque lot est une requête courte, enchaînée jusqu'à ce que le
 * serveur n'ait plus de source à traiter. L'avancement s'affiche dans une notification mise à
 * jour, et les exécutions de tous les lots sont réunies dans le bilan.
 */
export async function collectAllInBatches(
  fetchBatch: (body: { since?: string }) => Promise<CollectionBatch> = api.collectAll,
  onProgress?: (done: number, total: number) => void,
): Promise<CollectionRun[]> {
  const runs: CollectionRun[] = [];
  let since: string | undefined;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const batch = await fetchBatch(since === undefined ? {} : { since });
    since = batch.since;
    runs.push(...batch.runs);
    onProgress?.(Math.min(batch.total, batch.total - batch.remaining), batch.total);
    if (batch.remaining === 0 || batch.runs.length === 0) break;
  }
  return runs;
}

export function useCollectAll() {
  return useKoraMutation<void, CollectionRun[]>(
    () =>
      collectAllInBatches(api.collectAll, (done, total) => {
        toast.loading(`Collecte en cours : ${done} / ${plural(total, "source", "sources")}`, {
          id: PROGRESS_TOAST,
        });
      }).finally(() => toast.dismiss(PROGRESS_TOAST)),
    {
      onSuccess: (runs) => {
        const s = summarizeRuns(runs);
        const parts = [
          plural(s.observations, "nouvelle observation", "nouvelles observations"),
          plural(s.failed, "échec", "échecs"),
        ];
        if (s.blocked > 0) parts.push(plural(s.blocked, "collecte bloquée", "collectes bloquées"));
        const title = `Collecte terminée sur ${plural(s.total, "source", "sources")}`;
        if (s.failed + s.blocked > 0) toast.warning(title, { description: parts.join(" · ") });
        else toast.success(title, { description: parts.join(" · ") });
      },
    },
  );
}
