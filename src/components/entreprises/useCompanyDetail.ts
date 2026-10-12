import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { qk } from "@/lib/api/hooks";

/** Fiche entreprise avec ses sources rattachées (`GET /companies/:id`). */
export function useCompanyDetail(id: string | undefined) {
  return useQuery({
    queryKey: qk.company(id ?? ""),
    queryFn: () => api.company(id!),
    enabled: !!id,
  });
}
