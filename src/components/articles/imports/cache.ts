import { useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/api/hooks";
import type { HumanImport } from "@/lib/api/types";

/** Reporte immédiatement un import renvoyé par l'API dans la liste en cache. */
export function useUpsertImport() {
  const qc = useQueryClient();
  return (imp: HumanImport) =>
    qc.setQueryData<HumanImport[]>(qk.imports, (old) =>
      old?.some((i) => i.id === imp.id)
        ? old.map((i) => (i.id === imp.id ? imp : i))
        : [imp, ...(old ?? [])],
    );
}
