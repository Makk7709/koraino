import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "./client";
import type { LinkedInConnectComplete, SignalListQuery, UserInput, UserPatch } from "./types";

/** Clés React Query. Toute mutation invalide la racine `["kora"]` concernée. */
export const qk = {
  me: ["kora", "me"] as const,
  users: ["kora", "users"] as const,
  dashboard: (q?: object) => ["kora", "dashboard", q ?? {}] as const,
  search: (q: string) => ["kora", "search", q] as const,
  notifications: ["kora", "notifications"] as const,
  companies: (q?: object) => ["kora", "companies", q ?? {}] as const,
  company: (id: string) => ["kora", "company", id] as const,
  sources: (q?: object) => ["kora", "sources", q ?? {}] as const,
  runs: (q?: object) => ["kora", "runs", q ?? {}] as const,
  signals: (q?: SignalListQuery) => ["kora", "signals", q ?? {}] as const,
  signal: (id: string) => ["kora", "signal", id] as const,
  grids: ["kora", "grids"] as const,
  articles: (q?: object) => ["kora", "articles", q ?? {}] as const,
  article: (id: string) => ["kora", "article", id] as const,
  imports: ["kora", "imports"] as const,
  publications: (q?: object) => ["kora", "publications", q ?? {}] as const,
  linkedin: ["kora", "linkedin"] as const,
  linkedinConnection: ["kora", "linkedinConnection"] as const,
  newsletters: ["kora", "newsletters"] as const,
  newsletter: (id: string) => ["kora", "newsletter", id] as const,
  dna: ["kora", "dna"] as const,
  usage: ["kora", "usage"] as const,
  audit: (q?: object) => ["kora", "audit", q ?? {}] as const,
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return "Erreur inattendue";
}

/**
 * Mutation standard : toast de succès / d'erreur et invalidation de tout le cache KORA
 * (les compteurs du dashboard, de la sidebar et des listes restent cohérents).
 */
export function useKoraMutation<TVars, TData>(
  fn: (vars: TVars) => Promise<TData>,
  opts: {
    success?: string | ((data: TData) => string);
    invalidate?: QueryKey;
    onSuccess?: (data: TData) => void;
  } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: opts.invalidate ?? ["kora"] });
      const msg = typeof opts.success === "function" ? opts.success(data) : opts.success;
      if (msg) toast.success(msg);
      opts.onSuccess?.(data);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export const useMe = () => useQuery({ queryKey: qk.me, queryFn: api.me });
export const useUsers = () => useQuery({ queryKey: qk.users, queryFn: api.users });

/**
 * Gestion des comptes (admin) : invalide les comptes, l'utilisateur courant et le journal.
 * Pas de toast automatique : les retours dépendent du contexte (invitation, dialogue).
 */
function useAccountMutation<TVars, TData>(fn: (vars: TVars) => Promise<TData>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.users });
      void qc.invalidateQueries({ queryKey: qk.me });
      void qc.invalidateQueries({ queryKey: ["kora", "audit"] });
    },
  });
}

export const useCreateUser = () =>
  useAccountMutation((input: UserInput) => api.createUser(input));
export const useUpdateUser = () =>
  useAccountMutation(({ id, input }: { id: string; input: UserPatch }) =>
    api.updateUser(id, input),
  );
export const useDeleteUser = () => useAccountMutation((id: string) => api.deleteUser(id));
export const useResendInvitation = () =>
  useAccountMutation((id: string) => api.resendInvitation(id));
export const useDashboard = (q?: { from?: string; to?: string }) =>
  useQuery({ queryKey: qk.dashboard(q), queryFn: () => api.dashboard(q) });
export const useNotifications = () =>
  useQuery({ queryKey: qk.notifications, queryFn: api.notifications });
export const useCompanies = (q?: { q?: string; theme?: string }) =>
  useQuery({ queryKey: qk.companies(q), queryFn: () => api.companies(q) });
export const useSources = (q?: { companyId?: string; access?: string }) =>
  useQuery({ queryKey: qk.sources(q), queryFn: () => api.sources(q) });
export const useCollectionRuns = (q?: { sourceId?: string; limit?: number }) =>
  useQuery({ queryKey: qk.runs(q), queryFn: () => api.collectionRuns(q) });
export const useSignals = (q?: SignalListQuery) =>
  useQuery({ queryKey: qk.signals(q), queryFn: () => api.signals(q) });
export const useSignal = (id: string | null | undefined) =>
  useQuery({ queryKey: qk.signal(id ?? ""), queryFn: () => api.signal(id!), enabled: !!id });
export const useScoringGrids = () => useQuery({ queryKey: qk.grids, queryFn: api.scoringGrids });
export const useArticles = (q?: { status?: string; origin?: string }) =>
  useQuery({ queryKey: qk.articles(q), queryFn: () => api.articles(q) });
export const useArticle = (id: string | null | undefined) =>
  useQuery({ queryKey: qk.article(id ?? ""), queryFn: () => api.article(id!), enabled: !!id });
export const useImports = () => useQuery({ queryKey: qk.imports, queryFn: api.imports });
export const usePublications = (q?: { channel?: string; articleId?: string }) =>
  useQuery({ queryKey: qk.publications(q), queryFn: () => api.publications(q) });
export const useLinkedInPosts = () =>
  useQuery({ queryKey: qk.linkedin, queryFn: api.linkedinPosts });
export const useLinkedInConnection = () =>
  useQuery({ queryKey: qk.linkedinConnection, queryFn: api.linkedinConnection });
export const useLinkedInLink = () => useMutation({ mutationFn: () => api.startLinkedInConnect() });
export const useLinkedInComplete = () =>
  useMutation({
    mutationFn: (input: LinkedInConnectComplete) => api.completeLinkedInConnection(input),
  });
export const useLinkedInUnlink = () =>
  useKoraMutation(() => api.disconnectLinkedIn(), {
    success: "Compte LinkedIn déconnecté.",
  });
export const useNewsletters = () =>
  useQuery({ queryKey: qk.newsletters, queryFn: api.newsletters });
export const useEditorialDna = () => useQuery({ queryKey: qk.dna, queryFn: api.editorialDna });
export const useUsage = () => useQuery({ queryKey: qk.usage, queryFn: api.usage });
export const useAudit = (q?: { entity?: string; entityId?: string; limit?: number }) =>
  useQuery({ queryKey: qk.audit(q), queryFn: () => api.audit(q) });
