import { useMemo } from "react";
import { useCompanies, useMe } from "@/lib/api/hooks";
import type { Company } from "@/lib/api/types";

/** Index des entreprises par identifiant (partage le cache de `useCompanies()`). */
export function useCompanyMap() {
  const query = useCompanies();
  const map = useMemo(() => {
    const m = new Map<string, Company>();
    for (const c of query.data ?? []) m.set(c.id, c);
    return m;
  }, [query.data]);
  return { ...query, map };
}

/** Droits d'interface dérivés des rôles (le serveur reste l'autorité). */
export function usePermissions() {
  const me = useMe();
  const roles = me.data?.roles ?? [];
  const readOnly = roles.length > 0 && roles.every((r) => r === "lecteur");
  return {
    me: me.data,
    roles,
    readOnly,
    isAdmin: roles.includes("admin"),
    readOnlyTitle: readOnly ? "Profil lecteur : consultation seule" : undefined,
  };
}
