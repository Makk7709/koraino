import { toast } from "sonner";
import { RUN_STATUS } from "@/components/kora/labels";
import { api } from "@/lib/api/client";
import { useKoraMutation } from "@/lib/api/hooks";
import type { CollectionRun } from "@/lib/api/types";
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

export function useCollectAll() {
  return useKoraMutation<void, CollectionRun[]>(() => api.collectAll(), {
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
  });
}
