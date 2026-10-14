import { setAdapters } from "@/server/adapters";
import { now } from "@/server/clock";
import { RestWordPress, type RestWordPressOptions } from "@/server/wordpress/client";

/** Domaine réservé aux tests : aucune requête ne quitte le processus (fetch simulé). */
export const WP_SITE = "https://wp.example.test";
export const WP_USERNAME = "kora-redaction";
/** Forme d'un mot de passe d'application WordPress (groupes séparés par des espaces). */
export const WP_PASSWORD = "Xq7v Pt3k Lm9w Rz2b Hn5c Yd8f";
export const WP_PASSWORD_COMPACT = WP_PASSWORD.replace(/\s+/g, "");
export const WP_TOKEN = Buffer.from(`${WP_USERNAME}:${WP_PASSWORD_COMPACT}`).toString("base64");
/** Fragments du secret à rechercher partout (mot de passe, groupes, jeton Basic). */
export const WP_SECRETS = [WP_PASSWORD, WP_PASSWORD_COMPACT, WP_TOKEN, ...WP_PASSWORD.split(" ")];

export const KORA_ACCOUNT = 7;
export const OTHER_ACCOUNT = 3;

export interface FakePost {
  id: number;
  status: string;
  /** Tel que stocké par WordPress (kses : `&` → `&amp;` pour un Contributeur). */
  title: string;
  content: string;
  excerpt: string;
  author: number;
  date_gmt: string;
  modified_gmt: string;
  categories: number[];
  tags: number[];
}

export interface FakeTerm {
  id: number;
  name: string;
  slug: string;
  parent?: number;
}

export interface Recorded {
  method: string;
  url: URL;
  headers: Headers;
  body: Record<string, unknown> | null;
  redirect: RequestRedirect | undefined;
  signal: AbortSignal | null;
}

type Fault = Response | "timeout" | "network";

interface PendingFault {
  match: (r: Recorded) => boolean;
  fault: Fault;
  /** La requête est traitée (effet de bord appliqué) avant la panne : réponse perdue. */
  afterApply: boolean;
}

const stamp = (d: Date) => d.toISOString().slice(0, 19);
const kses = (text: string) => text.replace(/&(?!(?:[a-z]+|#\d+|#x[0-9a-f]+);)/gi, "&amp;");

export function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=UTF-8", ...headers },
  });
}

export function htmlResponse(status: number, html = "<!DOCTYPE html><html>Just a moment…</html>") {
  return new Response(html, { status, headers: { "content-type": "text/html; charset=UTF-8" } });
}

const wpError = (status: number, code: string, message: string) =>
  jsonResponse({ code, message, data: { status } }, status);

/**
 * Site WordPress simulé derrière `fetch` : API REST `/wp-json/wp/v2` telle que la voit un compte
 * Contributeur (mot de passe d'application), avec pannes injectables.
 */
export class FakeWordPressServer {
  posts = new Map<number, FakePost>();
  categories: FakeTerm[] = [
    { id: 11, name: "Financement", slug: "financement" },
    { id: 12, name: "Levée de fonds", slug: "levee-de-fonds" },
    { id: 13, name: "Distinction &amp; prix", slug: "distinction-prix" },
    { id: 14, name: "Innovation", slug: "innovation" },
    { id: 15, name: "Actualités", slug: "actualites" },
    { id: 16, name: "Économie", slug: "%c3%a9conomie" },
  ];
  tags: FakeTerm[] = [
    { id: 21, name: "Isère", slug: "isere" },
    { id: 22, name: "R&amp;D", slug: "r-d" },
    { id: 23, name: "Batteries", slug: "batteries" },
  ];
  me = {
    id: KORA_ACCOUNT,
    name: "KORA R&eacute;daction",
    roles: ["contributor"],
    capabilities: { edit_posts: true, publish_posts: false } as Record<string, boolean>,
  };
  requests: Recorded[] = [];
  /** Statut posé à la création par une extension de circuit éditorial (PublishPress…). */
  createStatus: string | null = null;
  private nextId = 100;
  private faults: PendingFault[] = [];

  /** Panne au prochain appel correspondant (une seule fois). */
  fail(match: (r: Recorded) => boolean, fault: Fault, options: { afterApply?: boolean } = {}) {
    this.faults.push({ match, fault, afterApply: options.afterApply ?? false });
  }

  addPost(patch: Partial<FakePost> = {}): FakePost {
    const at = stamp(now());
    const post: FakePost = {
      id: this.nextId++,
      status: "draft",
      title: "Brouillon existant",
      content: "",
      excerpt: "",
      author: KORA_ACCOUNT,
      date_gmt: at,
      modified_gmt: at,
      categories: [],
      tags: [],
      ...patch,
    };
    this.posts.set(post.id, post);
    return post;
  }

  writes() {
    return this.requests.filter((r) => r.method === "POST");
  }

  fetch = async (input: URL, init: RequestInit): Promise<Response> => {
    const recorded: Recorded = {
      method: init.method ?? "GET",
      url: new URL(input),
      headers: new Headers(init.headers),
      body:
        typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null,
      redirect: init.redirect,
      signal: init.signal ?? null,
    };
    this.requests.push(recorded);
    const index = this.faults.findIndex((f) => f.match(recorded));
    const pending = index >= 0 ? this.faults.splice(index, 1)[0]! : null;
    if (pending && !pending.afterApply) return this.raise(pending.fault);
    const response = this.handle(recorded);
    return pending ? this.raise(pending.fault) : response;
  };

  private raise(fault: Fault): Response {
    if (fault === "timeout") {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }
    if (fault === "network") throw new TypeError("fetch failed");
    return fault;
  }

  private handle(req: Recorded): Response {
    if (!req.url.href.startsWith(`${WP_SITE}/wp-json/wp/v2/`)) {
      return htmlResponse(404, "<html>Not Found</html>");
    }
    if (req.headers.get("authorization") !== `Basic ${WP_TOKEN}`) {
      return wpError(
        401,
        "incorrect_password",
        "Le mot de passe fourni pour l’identifiant <strong>kora-redaction</strong> est incorrect.",
      );
    }
    const path = req.url.pathname.slice("/wp-json/wp/v2".length);
    const q = req.url.searchParams;
    const edit = q.get("context") === "edit";
    if (req.method === "GET" && path === "/users/me") return jsonResponse(this.me);
    if (req.method === "GET" && path === "/categories") return this.page(this.categories, q);
    if (req.method === "GET" && path === "/tags") {
      // Comme WordPress : slugs exacts, ou « contient » sur le nom et le slug, trié par nom.
      const slugs = q.get("slug")?.split(",");
      const search = (q.get("search") ?? "").toLowerCase();
      const found = slugs
        ? this.tags.filter((t) => slugs.includes(t.slug))
        : this.tags.filter((t) => t.name.toLowerCase().includes(search) || t.slug.includes(search));
      return this.page(
        [...found].sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" })),
        q,
      );
    }
    if (req.method === "GET" && path === "/posts") {
      const statuses = (q.get("status") ?? "publish").split(",");
      const author = q.get("author");
      const words = (q.get("search") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      const list = [...this.posts.values()]
        .filter((p) => statuses.includes(p.status))
        .filter((p) => !author || p.author === Number(author))
        .filter((p) => words.every((w) => `${p.title} ${p.content}`.toLowerCase().includes(w)))
        .sort((a, b) => b.modified_gmt.localeCompare(a.modified_gmt));
      return this.page(
        list.map((p) => this.view(p, edit)),
        q,
      );
    }
    const one = /^\/posts\/(\d+)$/.exec(path);
    if (one) {
      const post = this.posts.get(Number(one[1]));
      if (!post) {
        return wpError(404, "rest_post_invalid_id", "Identifiant de publication non valide.");
      }
      const locked =
        post.author !== this.me.id || ["publish", "future", "private"].includes(post.status);
      if (req.method === "GET") {
        if (edit && locked) {
          return wpError(
            403,
            "rest_forbidden_context",
            "Désolé, vous n’avez pas l’autorisation de modifier cette publication.",
          );
        }
        if (!edit && post.status !== "publish" && post.author !== this.me.id) {
          return wpError(
            403,
            "rest_forbidden",
            "Désolé, vous n’avez pas l’autorisation de faire cela.",
          );
        }
        return jsonResponse(this.view(post, edit));
      }
      if (locked) {
        return wpError(
          403,
          "rest_cannot_edit",
          "Désolé, vous n’avez pas l’autorisation de modifier cette publication.",
        );
      }
      return this.write(req, post);
    }
    if (req.method === "POST" && path === "/posts") return this.write(req, null);
    return wpError(404, "rest_no_route", "Aucune route correspondante.");
  }

  private write(req: Recorded, existing: FakePost | null): Response {
    const body = req.body ?? {};
    // Un Contributeur peut enregistrer un brouillon ou le soumettre à relecture, jamais publier.
    const status = body["status"];
    if (status !== "draft" && status !== "pending") {
      return wpError(
        403,
        "rest_cannot_publish",
        "Désolé, vous n’avez pas l’autorisation de publier.",
      );
    }
    const at = stamp(now());
    const post = existing ?? this.addPost({ author: this.me.id, date_gmt: at });
    Object.assign(post, {
      status: existing ? status : (this.createStatus ?? status),
      title: kses(String(body["title"] ?? "")),
      content: String(body["content"] ?? ""),
      excerpt: String(body["excerpt"] ?? ""),
      modified_gmt: at,
      ...(Array.isArray(body["categories"]) ? { categories: body["categories"] as number[] } : {}),
      ...(Array.isArray(body["tags"]) ? { tags: body["tags"] as number[] } : {}),
    });
    return jsonResponse(this.view(post, true), existing ? 200 : 201);
  }

  private view(p: FakePost, edit: boolean) {
    const text = (raw: string) => (edit ? { raw, rendered: raw } : { rendered: raw });
    return {
      id: p.id,
      status: p.status,
      author: p.author,
      // Brouillon sans date fixée : WordPress renvoie la date de modification, ou null.
      date_gmt: p.status === "draft" ? null : p.date_gmt,
      modified_gmt: p.modified_gmt,
      link: `${WP_SITE}/?p=${p.id}`,
      title: text(p.title),
      content: text(p.content),
      excerpt: text(p.excerpt),
      categories: p.categories,
      tags: p.tags,
    };
  }

  private page<T>(items: T[], q: URLSearchParams): Response {
    const perPage = Number(q.get("per_page") ?? "10");
    const page = Number(q.get("page") ?? "1");
    const totalPages = Math.max(1, Math.ceil(items.length / perPage));
    return jsonResponse(items.slice((page - 1) * perPage, page * perPage), 200, {
      "x-wp-total": String(items.length),
      "x-wp-totalpages": String(totalPages),
    });
  }
}

export interface FakeWordPress {
  server: FakeWordPressServer;
  client: RestWordPress;
  /** Lignes du journal serveur du client. */
  logs: string[];
}

export function fakeWordPress(options: Omit<RestWordPressOptions, "fetch" | "log"> = {}) {
  const server = new FakeWordPressServer();
  const logs: string[] = [];
  const client = new RestWordPress(
    { site: WP_SITE, username: WP_USERNAME, appPassword: WP_PASSWORD_COMPACT },
    { ...options, fetch: server.fetch, log: (line) => logs.push(line) },
  );
  return { server, client, logs } satisfies FakeWordPress;
}

/** Client réel branché sur le faux site comme adaptateur WordPress du serveur. */
export function useFakeWordPress(options: Omit<RestWordPressOptions, "fetch" | "log"> = {}) {
  const fake = fakeWordPress(options);
  setAdapters({ wordpress: fake.client });
  return fake;
}

/** Vrai si un fragment du secret figure dans le texte. */
export function leaksSecret(text: string): boolean {
  return WP_SECRETS.some((s) => text.includes(s));
}
