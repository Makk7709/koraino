import type {
  ApiErrorBody,
  ApproveInput,
  Article,
  ArticleDetail,
  ArticleVersionInput,
  AuditEvent,
  CollectionRun,
  Company,
  CompanyInput,
  Dashboard,
  EditorialDna,
  EditorialRule,
  ExportEntity,
  HumanImport,
  ImportProposal,
  LinkedInConnectComplete,
  LinkedInConnection,
  LinkedInConnectStart,
  LinkedInPost,
  LinkedInPublishInput,
  NewsletterEdition,
  NewsletterItem,
  Notification,
  Paginated,
  PublicationAttempt,
  PublishInput,
  RuleProposal,
  ScoringGrid,
  ScoringGridInput,
  SearchResult,
  Signal,
  SignalDetail,
  SignalListQuery,
  SignalPatch,
  Source,
  SourceInput,
  UsageSnapshot,
  User,
  CreatedUser,
  InvitationResult,
  UserInput,
  UserPatch,
  WordPressCategory,
  WordPressCheck,
  WordPressSettings,
  WordPressStatus,
} from "./types";
import { getAccessToken, handleUnauthenticated } from "@/lib/auth/token";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

function toQuery(params?: object): string {
  if (!params) return "";
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

const isAuthRoute = (path: string) => path === "/auth" || path.startsWith("/auth/");

/**
 * Toute requête mutante porte l'en-tête `x-kora-request` : le serveur refuse les
 * écritures sans cet en-tête (protection CSRF basique pour les routes /api).
 * En mode supabase, le jeton de session part en `Authorization: Bearer` ; un 401 hors
 * `/auth/*` renvoie vers la page de connexion.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("x-kora-request", "1");
  if (init.body && !(init.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (!headers.has("authorization")) {
    const token = await getAccessToken();
    if (token) headers.set("authorization", `Bearer ${token}`);
  }
  const res = await fetch(`/api${path}`, { ...init, headers, credentials: "same-origin" });
  if (!res.ok) {
    let body: ApiErrorBody | null = null;
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      body = null;
    }
    if (!isAuthRoute(path)) {
      if (res.status === 401) void handleUnauthenticated("unauthenticated");
      else if (res.status === 403 && body?.error?.code === "account_not_authorized") {
        void handleUnauthenticated("account_not_authorized");
      }
    }
    throw new ApiError(
      res.status,
      body?.error.code ?? "http_error",
      body?.error.message ?? res.statusText,
      body?.error.details,
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? null : JSON.stringify(body),
});

/** URL directe (téléchargement) d'un export ou d'un fichier généré. */
export const downloadUrl = {
  export: (entity: ExportEntity, format: "csv" | "json") =>
    `/api/export/${entity}${toQuery({ format })}`,
  exportManifest: () => `/api/export/manifest`,
  newsletter: (id: string, format: "html" | "txt") =>
    `/api/newsletters/${id}/export${toQuery({ format })}`,
  linkedin: (id: string) => `/api/linkedin/${id}/export`,
};

export const api = {
  /* Session & utilisateurs */
  me: () => apiFetch<User>("/me"),
  switchUser: (userId: string) => apiFetch<User>("/me", json("POST", { userId })),
  users: () => apiFetch<User[]>("/users"),
  createUser: (input: UserInput) => apiFetch<CreatedUser>("/users", json("POST", input)),
  updateUser: (id: string, input: UserPatch) =>
    apiFetch<User>(`/users/${id}`, json("PATCH", input)),
  deleteUser: (id: string) => apiFetch<void>(`/users/${id}`, json("DELETE")),
  resendInvitation: (id: string) => apiFetch<InvitationResult>(`/users/${id}/invite`, json("POST")),

  /* Authentification (mode supabase) */
  /** Vérifie le jeton côté serveur et pose le cookie `__Host-kora_session` (liens de téléchargement). */
  openServerSession: (accessToken: string) =>
    apiFetch<User>("/auth/session", {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` },
    }),
  closeServerSession: () => apiFetch<void>("/auth/logout", json("POST")),

  /* Dashboard & recherche */
  dashboard: (q?: { from?: string; to?: string }) => apiFetch<Dashboard>(`/dashboard${toQuery(q)}`),
  search: (q: string) => apiFetch<SearchResult[]>(`/search${toQuery({ q })}`),
  notifications: () => apiFetch<Notification[]>("/notifications"),
  markNotificationsRead: () => apiFetch<void>("/notifications/read", json("POST")),

  /* Registre */
  companies: (q?: { q?: string; theme?: string }) => apiFetch<Company[]>(`/companies${toQuery(q)}`),
  company: (id: string) => apiFetch<Company & { sources: Source[] }>(`/companies/${id}`),
  createCompany: (input: CompanyInput) => apiFetch<Company>("/companies", json("POST", input)),
  updateCompany: (id: string, input: Partial<CompanyInput>) =>
    apiFetch<Company>(`/companies/${id}`, json("PATCH", input)),
  deleteCompany: (id: string) => apiFetch<void>(`/companies/${id}`, json("DELETE")),

  sources: (q?: { companyId?: string; access?: string }) =>
    apiFetch<Source[]>(`/sources${toQuery(q)}`),
  createSource: (input: SourceInput) => apiFetch<Source>("/sources", json("POST", input)),
  updateSource: (id: string, input: Partial<SourceInput> & { access?: Source["access"] }) =>
    apiFetch<Source>(`/sources/${id}`, json("PATCH", input)),
  deleteSource: (id: string) => apiFetch<void>(`/sources/${id}`, json("DELETE")),
  /** WF1 : collecte d'une source (simulée), puis classement des observations. */
  collectSource: (id: string) => apiFetch<CollectionRun>(`/sources/${id}/collect`, json("POST")),
  /** WF1 : collecte de toutes les sources actives. */
  collectAll: () => apiFetch<CollectionRun[]>("/collect", json("POST")),
  collectionRuns: (q?: { sourceId?: string; limit?: number }) =>
    apiFetch<CollectionRun[]>(`/collection-runs${toQuery(q)}`),

  /* Signal Engine */
  signals: (q?: SignalListQuery) => apiFetch<Paginated<Signal>>(`/signals${toQuery(q)}`),
  signal: (id: string) => apiFetch<SignalDetail>(`/signals/${id}`),
  updateSignal: (id: string, patch: SignalPatch) =>
    apiFetch<Signal>(`/signals/${id}`, json("PATCH", patch)),
  mergeSignals: (id: string, otherIds: string[]) =>
    apiFetch<Signal>(`/signals/${id}/merge`, json("POST", { otherIds })),
  /** Défusion : détache des observations dans un nouveau signal. */
  splitSignal: (id: string, observationIds: string[]) =>
    apiFetch<{ original: Signal; created: Signal }>(
      `/signals/${id}/split`,
      json("POST", { observationIds }),
    ),
  rescoreSignals: () => apiFetch<{ rescored: number }>("/signals/rescore", json("POST")),

  scoringGrids: () => apiFetch<ScoringGrid[]>("/scoring-grids"),
  createScoringGrid: (input: ScoringGridInput) =>
    apiFetch<ScoringGrid>("/scoring-grids", json("POST", input)),

  /* Studio (WF2), import humain (WF3), approbations */
  articles: (q?: { status?: string; origin?: string }) =>
    apiFetch<Article[]>(`/articles${toQuery(q)}`),
  article: (id: string) => apiFetch<ArticleDetail>(`/articles/${id}`),
  /** WF2 : dossier factuel + angles + brouillon sourcé à partir d'un signal sélectionné. */
  createArticleFromSignal: (signalId: string, angle?: string) =>
    apiFetch<ArticleDetail>("/articles", json("POST", { signalId, angle })),
  saveArticleVersion: (id: string, input: ArticleVersionInput) =>
    apiFetch<ArticleDetail>(`/articles/${id}/versions`, json("POST", input)),
  restoreArticleVersion: (id: string, version: number) =>
    apiFetch<ArticleDetail>(`/articles/${id}/restore`, json("POST", { version })),
  submitArticle: (id: string) => apiFetch<ArticleDetail>(`/articles/${id}/submit`, json("POST")),
  approveArticle: (id: string, input: ApproveInput) =>
    apiFetch<ArticleDetail>(`/articles/${id}/approve`, json("POST", input)),
  rejectArticle: (id: string, reason: string) =>
    apiFetch<ArticleDetail>(`/articles/${id}/reject`, json("POST", { reason })),
  publishArticle: (id: string, input: PublishInput) =>
    apiFetch<PublicationAttempt>(`/articles/${id}/publish`, json("POST", input)),
  /** Relit l'état du brouillon sur WordPress (brouillon, en attente, programmé, publié, supprimé). */
  refreshArticleWordPress: (id: string) =>
    apiFetch<ArticleDetail>(`/articles/${id}/wordpress/refresh`, json("POST")),
  /** Arbitrage humain d'un fait du dossier (lève une contradiction bloquante). */
  resolveFactCheck: (
    id: string,
    factCheckId: string,
    input: { status: "etaye" | "non_corrobore"; note?: string | null },
  ) => apiFetch<ArticleDetail>(`/articles/${id}/fact-checks/${factCheckId}`, json("PATCH", input)),

  imports: () => apiFetch<HumanImport[]>("/imports"),
  importFile: (file: File, author: string) => {
    const fd = new FormData();
    fd.set("file", file);
    fd.set("author", author);
    return apiFetch<HumanImport>("/imports", { method: "POST", body: fd });
  },
  decideImportProposal: (
    importId: string,
    proposalId: string,
    decision: ImportProposal["decision"],
  ) =>
    apiFetch<HumanImport>(
      `/imports/${importId}/proposals/${proposalId}`,
      json("PATCH", { decision }),
    ),
  /** Crée l'article à partir du texte extrait + propositions acceptées uniquement. */
  convertImport: (importId: string) =>
    apiFetch<ArticleDetail>(`/imports/${importId}/convert`, json("POST")),

  publications: (q?: { channel?: string; articleId?: string }) =>
    apiFetch<PublicationAttempt[]>(`/publications${toQuery(q)}`),

  /* LinkedIn (WF4) */
  linkedinPosts: () => apiFetch<LinkedInPost[]>("/linkedin"),
  createLinkedInPost: (input: { articleId?: string; signalId?: string }) =>
    apiFetch<LinkedInPost>("/linkedin", json("POST", input)),
  updateLinkedInPost: (
    id: string,
    input: { selectedVariantId?: string; variants?: LinkedInPost["variants"] },
  ) => apiFetch<LinkedInPost>(`/linkedin/${id}`, json("PATCH", input)),
  submitLinkedInPost: (id: string) =>
    apiFetch<LinkedInPost>(`/linkedin/${id}/submit`, json("POST")),
  approveLinkedInPost: (id: string, version: number) =>
    apiFetch<LinkedInPost>(`/linkedin/${id}/approve`, json("POST", { version })),
  publishLinkedInPost: (id: string, input?: LinkedInPublishInput) =>
    apiFetch<PublicationAttempt>(`/linkedin/${id}/publish`, json("POST", input)),

  /* Connecteur LinkedIn par utilisateur : chacun relie son propre compte. */
  linkedinConnection: () => apiFetch<LinkedInConnection>("/me/linkedin"),
  startLinkedInConnect: () => apiFetch<LinkedInConnectStart>("/me/linkedin/connect", json("POST")),
  completeLinkedInConnection: (input: LinkedInConnectComplete) =>
    apiFetch<{ ok: boolean }>("/me/linkedin/complete", json("POST", input)),
  disconnectLinkedIn: () => apiFetch<{ ok: boolean }>("/me/linkedin/disconnect", json("POST")),

  /* WordPress : configuration et correspondance des catégories */
  wordpressStatus: () => apiFetch<WordPressStatus>("/wordpress"),
  wordpressCheck: () => apiFetch<WordPressCheck>("/wordpress/check"),
  wordpressCategories: () => apiFetch<WordPressCategory[]>("/wordpress/categories"),
  saveWordPressSettings: (input: WordPressSettings) =>
    apiFetch<WordPressStatus>("/wordpress/settings", json("PUT", input)),

  /* Newsletter (WF5) */
  newsletters: () => apiFetch<NewsletterEdition[]>("/newsletters"),
  newsletter: (id: string) => apiFetch<NewsletterEdition>(`/newsletters/${id}`),
  createNewsletter: (input: { title?: string; weekOf?: string }) =>
    apiFetch<NewsletterEdition>("/newsletters", json("POST", input)),
  updateNewsletter: (
    id: string,
    input: {
      title?: string;
      intro?: string;
      items?: Pick<NewsletterItem, "id" | "summary" | "order">[];
    },
  ) => apiFetch<NewsletterEdition>(`/newsletters/${id}`, json("PATCH", input)),
  addNewsletterItem: (id: string, input: { signalId?: string; articleId?: string }) =>
    apiFetch<NewsletterEdition>(`/newsletters/${id}/items`, json("POST", input)),
  removeNewsletterItem: (id: string, itemId: string) =>
    apiFetch<NewsletterEdition>(`/newsletters/${id}/items/${itemId}`, json("DELETE")),
  approveNewsletter: (id: string, version: number) =>
    apiFetch<NewsletterEdition>(`/newsletters/${id}/approve`, json("POST", { version })),
  recordNewsletterExport: (id: string) =>
    apiFetch<NewsletterEdition>(`/newsletters/${id}/export`, json("POST")),
  setNewsletterIncludeNext: (signalId: string, include: boolean) =>
    apiFetch<Signal>(`/signals/${signalId}`, json("PATCH", { inNewsletter: include })),

  /* Editorial DNA (WF6) */
  editorialDna: () => apiFetch<EditorialDna>("/editorial-dna"),
  createRule: (input: Pick<EditorialRule, "kind" | "text">) =>
    apiFetch<EditorialRule>("/editorial-dna/rules", json("POST", input)),
  updateRule: (id: string, input: Partial<Pick<EditorialRule, "text" | "active">>) =>
    apiFetch<EditorialRule>(`/editorial-dna/rules/${id}`, json("PATCH", input)),
  decideRuleProposal: (id: string, decision: "acceptee" | "refusee") =>
    apiFetch<RuleProposal>(`/editorial-dna/proposals/${id}`, json("PATCH", { decision })),

  /* Exploitation */
  usage: () => apiFetch<UsageSnapshot>("/usage"),
  audit: (q?: { entity?: string; entityId?: string; limit?: number }) =>
    apiFetch<AuditEvent[]>(`/audit${toQuery(q)}`),
};
