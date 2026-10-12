import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { api } from "@/lib/api/client";
import { qk, useCompanies, useKoraMutation, useMe, useSignals } from "@/lib/api/hooks";
import type { Company, Paginated, Signal, SignalListQuery, SignalStatus } from "@/lib/api/types";
import type { FilterOption } from "./FilterSelect";
import { SIGNAL_STATUSES } from "./signal-utils";

/** Index id → entreprise (logos et noms des tables de signaux). */
export function useCompanyIndex(): Map<string, Company> {
  const companies = useCompanies();
  return useMemo(() => new Map((companies.data ?? []).map((c) => [c.id, c])), [companies.data]);
}

/** Taille de page maximale acceptée par GET /api/signals. */
const PAGE_SIZE = 200;

/** Première page de l'ensemble des signaux (facettes des filtres, analyses du dashboard). */
export const FACET_QUERY: SignalListQuery = { status: "tous", sort: "recent", limit: PAGE_SIZE };

function combinePages(results: UseQueryResult<Paginated<Signal>>[]) {
  return {
    items: results.flatMap((r) => r.data?.items ?? []),
    ready: results.every((r) => r.data !== undefined),
    isError: results.some((r) => r.isError),
  };
}

/** Tous les signaux, chargés par pages de 200 (même clé de cache que FACET_QUERY pour la première). */
export function useAllSignals() {
  const first = useSignals(FACET_QUERY);
  const pages = Math.max(0, Math.ceil((first.data?.total ?? 0) / PAGE_SIZE) - 1);
  const rest = useQueries({
    queries: Array.from({ length: pages }, (_, i) => {
      const q: SignalListQuery = { ...FACET_QUERY, offset: (i + 1) * PAGE_SIZE };
      return { queryKey: qk.signals(q), queryFn: () => api.signals(q) };
    }),
    combine: combinePages,
  });
  const data = useMemo(
    () => (first.data && rest.ready ? [...first.data.items, ...rest.items] : undefined),
    [first.data, rest.ready, rest.items],
  );
  return {
    data,
    isPending: !data && !first.isError && !rest.isError,
    isError: first.isError || rest.isError,
    refetch: first.refetch,
  };
}

/** Médias présents dans les signaux (options du filtre « Source »). */
export function useOutletOptions(): FilterOption[] {
  const all = useAllSignals();
  return useMemo(() => {
    const names = new Set<string>();
    for (const s of all.data ?? []) names.add(s.primaryOutlet.name);
    return [...names].sort((a, b) => a.localeCompare(b, "fr")).map((n) => ({ value: n, label: n }));
  }, [all.data]);
}

/** Entreprises du registre (options du filtre « Entreprise »). */
export function useCompanyOptions(): FilterOption[] {
  const companies = useCompanies();
  return useMemo(
    () =>
      (companies.data ?? [])
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, "fr"))
        .map((c) => ({ value: c.id, label: c.name })),
    [companies.data],
  );
}

/** Vrai si l'utilisateur courant n'a que le rôle lecteur (consultation seule). */
export function useIsReadOnly(): boolean {
  const me = useMe();
  return !!me.data && me.data.roles.every((r) => r === "lecteur");
}

/** Compteurs par statut (onglets de /signaux), sur les mêmes filtres que la liste. */
export function useSignalStatusCounts(base: Omit<SignalListQuery, "status" | "limit" | "sort">) {
  const keys: (SignalStatus | "tous")[] = [...SIGNAL_STATUSES, "tous"];
  const results = useQueries({
    queries: keys.map((status) => {
      const q: SignalListQuery = { ...base, status, limit: 1 };
      return { queryKey: qk.signals(q), queryFn: () => api.signals(q) };
    }),
  });
  const counts: Partial<Record<SignalStatus | "tous", number>> = {};
  keys.forEach((k, i) => {
    const total = results[i]?.data?.total;
    if (total !== undefined) counts[k] = total;
  });
  return counts;
}

/** Actions éditoriales d'un signal (toutes réelles, erreurs 403/422 en toast). */
export function useSignalActions() {
  const navigate = useNavigate();

  const createArticle = useKoraMutation(
    (v: { signalId: string; angle?: string | undefined }) =>
      api.createArticleFromSignal(v.signalId, v.angle),
    {
      success: "Brouillon d'article sourcé créé",
      onSuccess: (a) => void navigate({ href: `/articles?id=${encodeURIComponent(a.id)}` }),
    },
  );

  const toggleNewsletter = useKoraMutation(
    (v: { signalId: string; include: boolean }) =>
      api.updateSignal(v.signalId, { inNewsletter: v.include }),
    {
      success: (s) =>
        s.inNewsletter ? "Ajouté à la prochaine newsletter" : "Retiré de la prochaine newsletter",
    },
  );

  const createLinkedIn = useKoraMutation(
    (signalId: string) => api.createLinkedInPost({ signalId }),
    {
      success: "Post LinkedIn généré",
      onSuccess: (p) => void navigate({ href: `/linkedin?id=${encodeURIComponent(p.id)}` }),
    },
  );

  const reject = useKoraMutation(
    (v: { signalId: string; reason: string }) =>
      api.updateSignal(v.signalId, { status: "rejete", statusReason: v.reason }),
    { success: "Signal rejeté (motif enregistré)" },
  );

  const setStatus = useKoraMutation(
    (v: { signalId: string; status: SignalStatus }) =>
      api.updateSignal(v.signalId, { status: v.status, statusReason: null }),
    { success: "Statut mis à jour" },
  );

  const attachCompany = useKoraMutation(
    (v: { signalId: string; companyId: string | null }) =>
      api.updateSignal(v.signalId, { companyId: v.companyId }),
    { success: "Rattachement enregistré" },
  );

  const merge = useKoraMutation(
    (v: { targetId: string; otherIds: string[] }) => api.mergeSignals(v.targetId, v.otherIds),
    { success: "Signaux fusionnés" },
  );

  const split = useKoraMutation(
    (v: { signalId: string; observationIds: string[] }) =>
      api.splitSignal(v.signalId, v.observationIds),
    { success: "Observations détachées dans un nouveau signal" },
  );

  return {
    createArticle,
    toggleNewsletter,
    createLinkedIn,
    reject,
    setStatus,
    attachCompany,
    merge,
    split,
  };
}
