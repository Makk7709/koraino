import { z } from "zod";
import type { WordPressCategory } from "@/lib/api/types";
import {
  SimulatedWordPress,
  type DraftStatus,
  type RemotePost,
  type RemotePostStatus,
  type WordPressAccount,
  type WordPressClient,
  type WordPressDraftPayload,
} from "../adapters/channels";
import { readWordPressConfig, type WordPressConfig, type WordPressCredentials } from "./config";
import { notConfigured, WordPressError } from "./errors";
import { decodeEntities, htmlToText, textKey } from "./html";

export const WORDPRESS_TIMEOUT_MS = 15_000;
export const WORDPRESS_USER_AGENT = "KORA-Newsroom/1.0";
const PER_PAGE = 100;
const MAX_CATEGORY_PAGES = 50;
const DRAFT_SEARCH_SIZE = 20;
const TAG_LOOKUPS_IN_PARALLEL = 5;
/** Recherche d'étiquette par nom quand le slug calculé ne correspond pas : 3 pages au plus. */
const MAX_TAG_SEARCH_PAGES = 3;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export type WordPressFetch = (input: URL, init: RequestInit) => Promise<Response>;

export interface RestWordPressOptions {
  /** Remplace `fetch` (tests : aucun appel réseau réel). */
  fetch?: WordPressFetch;
  timeoutMs?: number;
  /** Journal serveur (console.error par défaut) ; les secrets y sont toujours masqués. */
  log?: (line: string) => void;
}

const POST_STATUSES: readonly RemotePostStatus[] = [
  "draft",
  "pending",
  "future",
  "publish",
  "private",
  "trash",
];

const rendered = z.union([
  z.string(),
  z.object({ raw: z.string().optional(), rendered: z.string().optional() }),
]);
const postSchema = z.object({
  id: z.number().int().positive(),
  status: z.string(),
  title: rendered.optional(),
  author: z.number().int().nonnegative().optional(),
  date_gmt: z.string().nullable().optional(),
  modified_gmt: z.string().nullable().optional(),
  link: z.string().nullable().optional(),
  content: rendered.optional(),
});
const userSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  roles: z.array(z.string()).optional(),
  capabilities: z.record(z.string(), z.unknown()).optional(),
});
const termSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  slug: z.string(),
  parent: z.number().int().nonnegative().optional(),
});
const errorSchema = z.object({ code: z.string().optional(), message: z.string().optional() });

function parseJson(text: string): unknown {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

/** Extrait sur une ligne, borné. Ne pas appeler directement sur un texte du site : `#excerpt` masque d'abord. */
function excerpt(text: string, max = 300): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Le secret, même découpé par des espaces ou des retours à la ligne (« abcd efgh … »). */
function secretPattern(secret: string): RegExp {
  const chars = [...secret].map((c) => c.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"));
  return new RegExp(chars.join("\\s*"), "g");
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function isTimeout(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

/** Dates `*_gmt` de WordPress : sans fuseau (UTC implicite), « 0000-… » si absentes. */
function gmt(value: string | null | undefined): string | null {
  if (!value || value.startsWith("0000")) return null;
  const t = Date.parse(/(?:z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function retryDelay(headers: Headers): string {
  const seconds = Number(headers.get("retry-after") ?? "");
  if (!Number.isFinite(seconds) || seconds <= 0) return "plus tard";
  return seconds < 120 ? `dans ${Math.ceil(seconds)} s` : `dans ${Math.ceil(seconds / 60)} min`;
}

/** Recherche d'étiquette : nom entier, ou son plus long fragment sans caractère encodé. */
function tagSearch(name: string): string {
  if (!/[&<>"']/.test(name)) return name.trim();
  return name
    .split(/[&<>"'\s]+/)
    .reduce((best, part) => (part.length > best.length ? part : best), "");
}

/** Approximation de `sanitize_title` de WordPress (« Isère » → `isere`, « R&D » → `rd`). */
function wordpressSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/\./g, "-")
    .replace(/[^a-z0-9 _-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Réponse 2xx inexploitable : après un envoi, WordPress a peut-être enregistré le contenu. */
function unreadable(status: number, method: "GET" | "POST"): WordPressError {
  return new WordPressError(
    "wordpress_invalid",
    method === "POST"
      ? `Réponse de WordPress illisible après l'envoi (HTTP ${status}) : le contenu a peut-être été enregistré.`
      : `Réponse de WordPress illisible (HTTP ${status}) : WORDPRESS_URL désigne-t-elle bien un site WordPress ?`,
    true,
  );
}

function base64(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

interface Reply {
  status: number;
  headers: Headers;
  data: unknown;
}

/**
 * Client REST du site WordPress (`/wp-json/wp/v2`), authentifié par mot de passe d'application
 * (compte dédié de rôle Contributeur). N'envoie jamais que des brouillons.
 */
export class RestWordPress implements WordPressClient {
  readonly name = "wordpress-rest";
  readonly mode = "reel" as const;
  readonly missing: string[] = [];
  readonly site: string;
  // Champs privés natifs : absents de toute sérialisation (JSON, console, instantané).
  readonly #authorization: string;
  readonly #secrets: RegExp[];
  readonly #fetch: WordPressFetch;
  readonly #timeoutMs: number;
  readonly #log: (line: string) => void;
  #accountId: Promise<number> | null = null;

  constructor(credentials: WordPressCredentials, options: RestWordPressOptions = {}) {
    this.site = credentials.site;
    const token = base64(`${credentials.username}:${credentials.appPassword}`);
    this.#authorization = `Basic ${token}`;
    this.#secrets = [credentials.appPassword, token]
      .filter((s) => s.length >= 4)
      .map(secretPattern);
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#timeoutMs = options.timeoutMs ?? WORDPRESS_TIMEOUT_MS;
    const log = options.log ?? ((line: string) => console.error(line));
    this.#log = (line) => log(this.#redact(line));
  }

  ownsRemote(remoteId: string, site: string | null | undefined) {
    return /^\d+$/.test(remoteId) && site === this.site;
  }

  editUrl(remoteId: string) {
    return /^\d+$/.test(remoteId)
      ? `${this.site}/wp-admin/post.php?post=${remoteId}&action=edit`
      : null;
  }

  async whoAmI(): Promise<WordPressAccount> {
    const { status, data } = await this.#send("GET", "/users/me", { context: "edit" });
    const user = userSchema.safeParse(data);
    if (!user.success) throw this.#unreadable("GET /users/me", status, "GET");
    const caps = user.data.capabilities;
    const account: WordPressAccount = {
      id: user.data.id,
      name: this.#redact(htmlToText(user.data.name)),
      roles: user.data.roles ?? null,
      canPublish: caps ? caps["publish_posts"] === true : null,
    };
    this.#accountId = Promise.resolve(account.id);
    return account;
  }

  async getPost(remoteId: string) {
    if (!/^\d+$/.test(remoteId)) return null;
    const path = `/posts/${remoteId}`;
    const edit = await this.#send("GET", path, { context: "edit" }, undefined, [403, 404, 410]);
    if (this.#gone(edit, remoteId)) return null;
    if (edit.status !== 403) return this.#post(edit, "GET");
    // Contenu publié ou programmé : le Contributeur ne peut plus l'éditer, mais peut le lire.
    const view = await this.#send("GET", path, {}, undefined, [401, 403, 404, 410]);
    if (this.#gone(view, remoteId)) return null;
    if (view.status === 401 || view.status === 403) {
      throw new WordPressError(
        "wordpress_forbidden",
        `Le compte WordPress de KORA ne peut plus lire le contenu n° ${remoteId} (auteur modifié ou droits retirés).`,
      );
    }
    return this.#post(view, "GET");
  }

  /**
   * Contenu supprimé : 410, ou 404 `rest_post_invalid_id`. Tout autre 404 (`rest_no_route` d'une
   * API filtrée ou en panne passagère) est une erreur : en conclure une suppression créerait un doublon.
   */
  #gone(reply: Reply, remoteId: string): boolean {
    if (reply.status === 410) return true;
    if (reply.status !== 404) return false;
    const code = errorSchema.safeParse(reply.data).data?.code ?? "";
    if (code === "rest_post_invalid_id") return true;
    this.#log(`[wordpress] GET /posts/${remoteId} → HTTP 404 ${this.#excerpt(code, 60) || "sans code"}`);
    throw new WordPressError(
      "wordpress_invalid",
      `WordPress répond « introuvable » pour le contenu n° ${remoteId} sans indiquer qu'il a été supprimé (HTTP 404${code ? ` ${this.#excerpt(code, 60)}` : ""}) : API REST filtrée ou indisponible ? Réessayez plus tard.`,
    );
  }

  async findOwnDrafts(search: string, since: string, until: string) {
    const author = await this.#ownId();
    const from = Date.parse(since);
    const to = Date.parse(until);
    // Jeton unique : quelques résultats au plus (contenus bruts inclus, d'où une seule page courte).
    const { status, data } = await this.#send("GET", "/posts", {
      context: "edit",
      status: "draft,pending",
      author: String(author),
      search,
      orderby: "modified",
      order: "desc",
      per_page: String(DRAFT_SEARCH_SIZE),
      _fields: "id,status,title,author,date_gmt,modified_gmt,link,content",
    });
    if (!Array.isArray(data)) throw this.#unreadable("GET /posts", status, "GET");
    const modified = (p: RemotePost) => Date.parse(p.modifiedGmt ?? p.dateGmt ?? "");
    return data
      .map((item) => this.#post({ status, data: item }, "GET"))
      .filter((p) => p.authorId === author && modified(p) >= from && modified(p) <= to);
  }

  async createDraft(input: WordPressDraftPayload) {
    return this.#post(
      await this.#send("POST", "/posts", {}, this.#payload(input, "draft")),
      "POST",
    );
  }

  async updateDraft(remoteId: string, input: WordPressDraftPayload, status: DraftStatus = "draft") {
    if (!/^\d+$/.test(remoteId)) {
      throw new WordPressError(
        "wordpress_invalid",
        `Identifiant WordPress invalide : ${remoteId}.`,
      );
    }
    return this.#post(
      await this.#send("POST", `/posts/${remoteId}`, {}, this.#payload(input, status)),
      "POST",
    );
  }

  async listCategories() {
    return this.#pages(
      "/categories",
      { _fields: "id,name,slug,parent", orderby: "name", order: "asc", hide_empty: "false" },
      MAX_CATEGORY_PAGES,
      (item, status) => this.#term(item, status),
    );
  }

  /**
   * Étiquettes existantes de même nom : d'abord par slug exact (une requête pour toutes), puis, pour
   * les autres, par recherche paginée (la recherche WordPress est un « contient » trié par nom :
   * l'étiquette exacte peut être au-delà de la première page).
   */
  async findTags(names: string[]) {
    const unique = [...new Map(names.map((n) => [textKey(n), n.trim()])).values()].filter(Boolean);
    const found = await this.#tagsBySlug(unique);
    const rest = unique.filter((name) => !found.has(textKey(name)));
    for (let i = 0; i < rest.length; i += TAG_LOOKUPS_IN_PARALLEL) {
      const batch = rest.slice(i, i + TAG_LOOKUPS_IN_PARALLEL);
      const ids = await Promise.all(batch.map((name) => this.#searchTag(name)));
      ids.forEach((id, j) => id !== null && found.set(textKey(batch[j]!), id));
    }
    const ids = unique.flatMap((name) => found.get(textKey(name)) ?? []);
    const missing = unique.filter((name) => !found.has(textKey(name)));
    return { ids: [...new Set(ids)], missing };
  }

  /** Slug calculé comme WordPress : un raccourci seulement, le nom doit aussi correspondre. */
  async #tagsBySlug(names: string[]): Promise<Map<string, number>> {
    const found = new Map<string, number>();
    const slugs = [...new Set(names.map(wordpressSlug).filter(Boolean))];
    if (!slugs.length) return found;
    const { status, data } = await this.#send("GET", "/tags", {
      slug: slugs.join(","),
      per_page: String(PER_PAGE),
      _fields: "id,name,slug",
    });
    if (!Array.isArray(data)) throw this.#unreadable("GET /tags", status, "GET");
    const wanted = new Set(names.map(textKey));
    for (const term of data.map((t) => this.#term(t, status))) {
      const key = textKey(term.name);
      if (wanted.has(key)) found.set(key, term.id);
    }
    return found;
  }

  async #searchTag(name: string): Promise<number | null> {
    const search = tagSearch(name);
    if (!search) return null;
    const key = textKey(name);
    for (let page = 1; page <= MAX_TAG_SEARCH_PAGES; page++) {
      const { status, headers, data } = await this.#send("GET", "/tags", {
        search,
        per_page: String(PER_PAGE),
        page: String(page),
        _fields: "id,name,slug",
      });
      if (!Array.isArray(data)) throw this.#unreadable("GET /tags", status, "GET");
      const match = data.map((t) => this.#term(t, status)).find((t) => textKey(t.name) === key);
      if (match) return match.id;
      const total = Number(headers.get("x-wp-totalpages"));
      if (data.length < PER_PAGE || (total > 0 && page >= total)) break;
    }
    return null;
  }

  #ownId(): Promise<number> {
    this.#accountId ??= this.whoAmI().then(
      (a) => a.id,
      (error: unknown) => {
        this.#accountId = null;
        throw error;
      },
    );
    return this.#accountId;
  }

  #payload(input: WordPressDraftPayload, status: DraftStatus) {
    return {
      title: input.title,
      content: input.content,
      excerpt: input.excerpt,
      // Garde-fou à l'exécution : jamais un statut public, quoi qu'en dise l'appelant.
      status: status === "pending" ? "pending" : "draft",
      ...(input.categories.length ? { categories: input.categories } : {}),
      ...(input.tags.length ? { tags: input.tags } : {}),
    };
  }

  #post(reply: Pick<Reply, "status" | "data">, method: "GET" | "POST"): RemotePost {
    const parsed = postSchema.safeParse(reply.data);
    if (!parsed.success) throw this.#unreadable(`${method} /posts`, reply.status, method);
    const p = parsed.data;
    const status = POST_STATUSES.find((s) => s === p.status);
    if (!status) {
      throw new WordPressError(
        "wordpress_invalid",
        `WordPress indique un statut inattendu (« ${this.#excerpt(p.status, 40)} ») pour le contenu n° ${p.id} : KORA n'y touche pas.`,
      );
    }
    const title =
      typeof p.title === "string"
        ? htmlToText(p.title)
        : p.title?.raw !== undefined
          ? decodeEntities(p.title.raw)
          : htmlToText(p.title?.rendered ?? "");
    return {
      id: String(p.id),
      status,
      title: this.#redact(title),
      authorId: p.author ?? null,
      dateGmt: gmt(p.date_gmt),
      modifiedGmt: gmt(p.modified_gmt),
      link: p.link ?? null,
      content: typeof p.content === "object" ? (p.content.raw ?? null) : null,
    };
  }

  #term(item: unknown, status: number): WordPressCategory {
    const term = termSchema.safeParse(item);
    if (!term.success) throw this.#unreadable("GET /terms", status, "GET");
    return {
      id: term.data.id,
      slug: term.data.slug,
      name: this.#redact(htmlToText(term.data.name)),
      parent: term.data.parent ?? 0,
    };
  }

  async #pages<T>(
    path: string,
    query: Record<string, string>,
    maxPages: number,
    map: (item: unknown, status: number) => T,
  ): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const { status, headers, data } = await this.#send("GET", path, {
        ...query,
        per_page: String(PER_PAGE),
        page: String(page),
      });
      if (!Array.isArray(data)) throw this.#unreadable(`GET ${path}`, status, "GET");
      out.push(...data.map((item) => map(item, status)));
      const total = Number(headers.get("x-wp-totalpages"));
      if (data.length < PER_PAGE || (total > 0 && page >= total)) break;
    }
    return out;
  }

  /**
   * Un seul aller-retour, sans suivre les redirections (l'en-tête d'authentification ne doit
   * jamais partir ailleurs). `allow` : statuts JSON rendus à l'appelant au lieu d'une erreur.
   */
  async #send(
    method: "GET" | "POST",
    path: string,
    query: Record<string, string> = {},
    body?: unknown,
    allow: number[] = [],
  ): Promise<Reply> {
    const url = new URL(`${this.site}/wp-json/wp/v2${path}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const where = `[wordpress] ${method} ${url.pathname}`;
    let res: Response;
    let text: string;
    try {
      res = await this.#fetch(url, {
        method,
        headers: {
          Authorization: this.#authorization,
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": WORDPRESS_USER_AGENT,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "manual",
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      text = await this.#read(res, where, method);
    } catch (error) {
      if (error instanceof WordPressError) throw error;
      const timeout = isTimeout(error);
      this.#log(`${where} : ${timeout ? "délai dépassé" : "échec réseau"} (${describe(error)})`);
      throw new WordPressError(
        "wordpress_unavailable",
        timeout
          ? `WordPress n'a pas répondu dans les ${Math.round(this.#timeoutMs / 1000)} secondes.`
          : "Le site WordPress est injoignable (coupure réseau ou adresse introuvable).",
        true,
      );
    }
    const html = /html/i.test(res.headers.get("content-type") ?? "") || /^\s*</.test(text);
    if (res.status >= 300 && res.status < 400) {
      this.#log(`${where} → HTTP ${res.status} vers ${res.headers.get("location") ?? "?"}`);
      throw new WordPressError(
        "wordpress_invalid",
        `WordPress a répondu par une redirection (HTTP ${res.status}) : vérifiez WORDPRESS_URL (https, www, sous-dossier d'installation).`,
      );
    }
    if (!res.ok) {
      if (!html && allow.includes(res.status)) {
        return { status: res.status, headers: res.headers, data: parseJson(text) };
      }
      this.#log(`${where} → HTTP ${res.status} : ${this.#excerpt(text) || "(corps vide)"}`);
      throw this.#failure(res.status, text, html, res.headers);
    }
    const data = html ? undefined : parseJson(text);
    if (data === undefined) {
      this.#log(
        `${where} → HTTP ${res.status} illisible : ${this.#excerpt(text) || "(corps vide)"}`,
      );
      throw unreadable(res.status, method);
    }
    return { status: res.status, headers: res.headers, data };
  }

  /** Corps lu en flux, plafonné : un site compromis ou mal configuré ne doit pas épuiser la mémoire. */
  async #read(res: Response, where: string, method: "GET" | "POST"): Promise<string> {
    const tooLarge = () => {
      this.#log(`${where} → HTTP ${res.status} : réponse de plus de 2 Mo, non lue`);
      return new WordPressError(
        "wordpress_invalid",
        method === "POST"
          ? "Réponse de WordPress trop volumineuse (plus de 2 Mo) après l'envoi : le contenu a peut-être été enregistré."
          : "Réponse de WordPress trop volumineuse (plus de 2 Mo) : KORA ne la lit pas. Vérifiez WORDPRESS_URL et les extensions qui modifient l'API REST.",
        method === "POST",
      );
    };
    if (Number(res.headers.get("content-length") ?? "") > MAX_RESPONSE_BYTES) {
      await res.body?.cancel().catch(() => {});
      throw tooLarge();
    }
    if (!res.body) return "";
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        throw tooLarge();
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  }

  #unreadable(where: string, status: number, method: "GET" | "POST"): WordPressError {
    this.#log(`[wordpress] ${where} → HTTP ${status} : forme de réponse inattendue`);
    return unreadable(status, method);
  }

  #failure(status: number, text: string, html: boolean, headers: Headers): WordPressError {
    const body = errorSchema.safeParse(html ? null : parseJson(text));
    const message =
      body.success && body.data.message ? htmlToText(this.#redact(body.data.message)) : "";
    const detail = message ? ` : « ${this.#excerpt(message, 200)} »` : "";
    const blocked = `Le site a bloqué la requête de KORA (HTTP ${status}, page HTML) : un pare-feu ou une protection anti-robots (Cloudflare) filtre l'accès à l'API. Demandez d'autoriser KORA (User-Agent ${WORDPRESS_USER_AGENT}) sur /wp-json/.`;
    if (status === 401) {
      return new WordPressError(
        "wordpress_auth_failed",
        html
          ? "Le serveur exige une authentification avant WordPress (HTTP 401, page HTML) : le site est peut-être protégé par un mot de passe d'accès (préproduction), incompatible avec le mot de passe d'application."
          : `WordPress a refusé les identifiants de KORA (HTTP 401${detail}) : vérifiez l'identifiant (WORDPRESS_USERNAME) et le mot de passe d'application (WORDPRESS_APP_PASSWORD).`,
      );
    }
    if (status === 403) {
      return html
        ? new WordPressError("wordpress_blocked", blocked)
        : new WordPressError(
            "wordpress_forbidden",
            `Le compte WordPress de KORA n'a pas le droit d'effectuer cette action (HTTP 403${detail}).`,
          );
    }
    if (status === 429) {
      return html
        ? new WordPressError("wordpress_blocked", blocked)
        : new WordPressError(
            "wordpress_rate_limited",
            `WordPress limite le nombre de requêtes (HTTP 429) : réessayez ${retryDelay(headers)}.`,
          );
    }
    if (status === 503 && html) {
      return new WordPressError(
        "wordpress_blocked",
        "Le site WordPress est indisponible ou protégé (HTTP 503, page HTML) : maintenance en cours ou protection anti-robots (Cloudflare). Réessayez plus tard.",
        true,
      );
    }
    if (status >= 500) {
      return new WordPressError(
        "wordpress_unavailable",
        `WordPress est momentanément indisponible (HTTP ${status}).`,
        true,
      );
    }
    if (status === 404) {
      return new WordPressError(
        "wordpress_invalid",
        `Ressource introuvable sur WordPress (HTTP 404${detail}) : vérifiez WORDPRESS_URL et l'accès à l'API REST.`,
      );
    }
    if (status === 413) {
      return new WordPressError(
        "wordpress_invalid",
        "Contenu trop volumineux pour le site WordPress (HTTP 413).",
      );
    }
    return new WordPressError(
      "wordpress_invalid",
      `WordPress a refusé la requête (HTTP ${status}${detail}).`,
    );
  }

  /** Mot de passe et jeton Basic (avec ou sans espaces), et tout en-tête Basic. */
  #redact(text: string): string {
    let out = text;
    for (const secret of this.#secrets) out = out.replace(secret, "[masqué]");
    return out.replace(/Basic\s+[A-Za-z0-9+/=]{8,}/gi, "Basic [masqué]");
  }

  /** Masque AVANT de tronquer : un secret coupé par la limite ne serait plus reconnu. */
  #excerpt(text: string, max = 300): string {
    return excerpt(this.#redact(text), max);
  }
}

/** Mode `non_configure` : toute opération répond 503 `wordpress_not_configured`. */
export class UnconfiguredWordPress implements WordPressClient {
  readonly name = "wordpress-non-configure";
  readonly mode = "non_configure" as const;
  readonly site = null;

  constructor(
    readonly missing: string[],
    private readonly invalidUrl = false,
  ) {}

  ownsRemote(_remoteId: string, _site: string | null | undefined) {
    return false;
  }

  editUrl(_remoteId: string) {
    return null;
  }

  private fail(): never {
    throw notConfigured(this.missing, this.invalidUrl);
  }

  async whoAmI(): Promise<WordPressAccount> {
    return this.fail();
  }
  async getPost(_remoteId: string): Promise<RemotePost | null> {
    return this.fail();
  }
  async findOwnDrafts(_search: string, _since: string, _until: string): Promise<RemotePost[]> {
    return this.fail();
  }
  async createDraft(_input: WordPressDraftPayload): Promise<RemotePost> {
    return this.fail();
  }
  async updateDraft(
    _remoteId: string,
    _input: WordPressDraftPayload,
    _status?: DraftStatus,
  ): Promise<RemotePost> {
    return this.fail();
  }
  async listCategories(): Promise<WordPressCategory[]> {
    return this.fail();
  }
  async findTags(_names: string[]): Promise<{ ids: number[]; missing: string[] }> {
    return this.fail();
  }
}

/** Client correspondant au mode : réel, simulé (tests, démonstration) ou non configuré. */
export function createWordPressClient(
  config: WordPressConfig = readWordPressConfig(),
  options: RestWordPressOptions = {},
): WordPressClient {
  if (config.mode === "reel") return new RestWordPress(config.credentials, options);
  if (config.mode === "simule") return new SimulatedWordPress();
  return new UnconfiguredWordPress(config.missing, config.invalidUrl);
}
