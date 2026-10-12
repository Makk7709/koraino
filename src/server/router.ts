import { now } from "./clock";
import type { Ctx, Handler } from "./context";
import { errorResponse, forbidden, HttpError, json, parseCookies, SESSION_COOKIE } from "./http";
import * as articles from "./handlers/articles";
import * as dist from "./handlers/distribution";
import * as imports from "./handlers/imports";
import * as ops from "./handlers/ops";
import * as registry from "./handlers/registry";
import * as session from "./handlers/session";
import * as signals from "./handlers/signals";
import { getRepository } from "./store/memory";
import { DEFAULT_USER_ID } from "./store/seed";

type Method = "GET" | "POST" | "PATCH" | "DELETE";

interface RouteDef {
  method: Method;
  pattern: string;
  handler: Handler;
  /** Corps multipart/form-data (imports) au lieu de JSON. */
  multipart?: boolean;
}

interface CompiledRoute extends RouteDef {
  segments: string[];
}

/** Table des routes : METHOD + motif avec paramètres `:id`. L'ordre départage les motifs ambigus. */
const ROUTES: RouteDef[] = [
  { method: "GET", pattern: "/me", handler: session.getMe },
  { method: "POST", pattern: "/me", handler: session.switchUser },
  { method: "GET", pattern: "/users", handler: session.listUsers },
  { method: "GET", pattern: "/notifications", handler: session.listNotifications },
  { method: "POST", pattern: "/notifications/read", handler: session.markNotificationsRead },

  { method: "GET", pattern: "/dashboard", handler: ops.getDashboard },
  { method: "GET", pattern: "/search", handler: ops.search },
  { method: "GET", pattern: "/usage", handler: ops.getUsage },
  { method: "GET", pattern: "/audit", handler: ops.listAudit },
  { method: "GET", pattern: "/export/manifest", handler: ops.exportManifest },
  { method: "GET", pattern: "/export/:entity", handler: ops.exportEntity },

  { method: "GET", pattern: "/companies", handler: registry.listCompanies },
  { method: "POST", pattern: "/companies", handler: registry.createCompany },
  { method: "GET", pattern: "/companies/:id", handler: registry.getCompany },
  { method: "PATCH", pattern: "/companies/:id", handler: registry.updateCompany },
  { method: "DELETE", pattern: "/companies/:id", handler: registry.deleteCompany },
  { method: "GET", pattern: "/sources", handler: registry.listSources },
  { method: "POST", pattern: "/sources", handler: registry.createSource },
  { method: "PATCH", pattern: "/sources/:id", handler: registry.updateSource },
  { method: "DELETE", pattern: "/sources/:id", handler: registry.deleteSource },
  { method: "POST", pattern: "/sources/:id/collect", handler: signals.collectSourceHandler },
  { method: "POST", pattern: "/collect", handler: signals.collectAllHandler },
  { method: "GET", pattern: "/collection-runs", handler: signals.listRuns },

  { method: "GET", pattern: "/signals", handler: signals.listSignals },
  { method: "POST", pattern: "/signals/rescore", handler: signals.rescoreSignals },
  { method: "GET", pattern: "/signals/:id", handler: signals.getSignal },
  { method: "PATCH", pattern: "/signals/:id", handler: signals.patchSignal },
  { method: "POST", pattern: "/signals/:id/merge", handler: signals.mergeSignals },
  { method: "POST", pattern: "/signals/:id/split", handler: signals.splitSignal },
  { method: "GET", pattern: "/scoring-grids", handler: signals.listGrids },
  { method: "POST", pattern: "/scoring-grids", handler: signals.createGrid },

  { method: "GET", pattern: "/articles", handler: articles.listArticles },
  { method: "POST", pattern: "/articles", handler: articles.createArticle },
  { method: "GET", pattern: "/articles/:id", handler: articles.getArticle },
  { method: "POST", pattern: "/articles/:id/versions", handler: articles.saveVersion },
  { method: "POST", pattern: "/articles/:id/restore", handler: articles.restoreVersion },
  { method: "POST", pattern: "/articles/:id/submit", handler: articles.submitArticle },
  { method: "POST", pattern: "/articles/:id/approve", handler: articles.approveArticle },
  { method: "POST", pattern: "/articles/:id/reject", handler: articles.rejectArticle },
  { method: "POST", pattern: "/articles/:id/publish", handler: articles.publishArticle },
  {
    method: "PATCH",
    pattern: "/articles/:id/fact-checks/:fid",
    handler: articles.resolveFactCheck,
  },
  { method: "GET", pattern: "/publications", handler: articles.listPublications },

  { method: "GET", pattern: "/imports", handler: imports.listImports },
  { method: "POST", pattern: "/imports", handler: imports.createImport, multipart: true },
  { method: "PATCH", pattern: "/imports/:id/proposals/:pid", handler: imports.decideProposal },
  { method: "POST", pattern: "/imports/:id/convert", handler: imports.convertImport },

  { method: "GET", pattern: "/linkedin", handler: dist.listLinkedIn },
  { method: "POST", pattern: "/linkedin", handler: dist.createLinkedIn },
  { method: "PATCH", pattern: "/linkedin/:id", handler: dist.updateLinkedIn },
  { method: "POST", pattern: "/linkedin/:id/submit", handler: dist.submitLinkedIn },
  { method: "POST", pattern: "/linkedin/:id/approve", handler: dist.approveLinkedIn },
  { method: "POST", pattern: "/linkedin/:id/publish", handler: dist.publishLinkedIn },
  { method: "GET", pattern: "/linkedin/:id/export", handler: dist.exportLinkedIn },

  { method: "GET", pattern: "/newsletters", handler: dist.listNewsletters },
  { method: "POST", pattern: "/newsletters", handler: dist.createNewsletter },
  { method: "GET", pattern: "/newsletters/:id", handler: dist.getNewsletter },
  { method: "PATCH", pattern: "/newsletters/:id", handler: dist.updateNewsletter },
  { method: "POST", pattern: "/newsletters/:id/items", handler: dist.addNewsletterItem },
  {
    method: "DELETE",
    pattern: "/newsletters/:id/items/:itemId",
    handler: dist.removeNewsletterItem,
  },
  { method: "POST", pattern: "/newsletters/:id/approve", handler: dist.approveNewsletter },
  { method: "GET", pattern: "/newsletters/:id/export", handler: dist.exportNewsletter },

  { method: "GET", pattern: "/editorial-dna", handler: dist.getEditorialDna },
  { method: "POST", pattern: "/editorial-dna/rules", handler: dist.createRule },
  { method: "PATCH", pattern: "/editorial-dna/rules/:id", handler: dist.updateRule },
  { method: "PATCH", pattern: "/editorial-dna/proposals/:id", handler: dist.decideRuleProposal },
];

const COMPILED: CompiledRoute[] = ROUTES.map((r) => ({
  ...r,
  segments: r.pattern.split("/").filter(Boolean),
}));

/** Taille maximale d'un corps JSON. */
const MAX_JSON_BYTES = 1024 * 1024;

function matchSegments(route: CompiledRoute, parts: string[]): Record<string, string> | null {
  if (route.segments.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    const expected = route.segments[i]!;
    const actual = parts[i]!;
    if (expected.startsWith(":")) {
      try {
        params[expected.slice(1)] = decodeURIComponent(actual);
      } catch {
        return null;
      }
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}

type Resolution =
  | { kind: "found"; route: CompiledRoute; params: Record<string, string> }
  | { kind: "missing"; allowed: Method[] };

function resolve(method: string, path: string): Resolution {
  const parts = path.split("/").filter(Boolean);
  const allowed = new Set<Method>();
  for (const route of COMPILED) {
    const params = matchSegments(route, parts);
    if (!params) continue;
    if (route.method === method) return { kind: "found", route, params };
    allowed.add(route.method);
  }
  return { kind: "missing", allowed: [...allowed] };
}

async function readJson(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_JSON_BYTES)
    throw new HttpError(413, "payload_too_large", "Requête trop volumineuse (1 Mo maximum).");
  const text = await request.text();
  if (text.length > MAX_JSON_BYTES)
    throw new HttpError(413, "payload_too_large", "Requête trop volumineuse (1 Mo maximum).");
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(400, "invalid_json", "Corps JSON invalide.");
  }
}

async function readForm(request: Request): Promise<FormData> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("multipart/form-data")) {
    throw new HttpError(
      400,
      "multipart_required",
      "Envoyez le fichier en multipart/form-data (champs file et author).",
    );
  }
  imports.assertImportSize(request);
  try {
    return await request.formData();
  } catch {
    throw new HttpError(400, "invalid_multipart", "Corps multipart illisible.");
  }
}

/**
 * Point d'entrée de l'API métier (/api/*). Contrôles transverses : en-tête anti-CSRF sur
 * toute écriture, session par cookie, validation, erreurs au format `ApiErrorBody`.
 */
export async function handleApiRequest(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api(?=\/|$)/, "").replace(/\/+$/, "") || "/";
    const method = request.method.toUpperCase() === "HEAD" ? "GET" : request.method.toUpperCase();

    if (method !== "GET" && method !== "OPTIONS" && request.headers.get("x-kora-request") !== "1") {
      throw forbidden(
        "En-tête x-kora-request manquant : requête d'écriture refusée.",
        "csrf_header_missing",
      );
    }

    const found = resolve(method, path);
    if (found.kind === "missing") {
      if (method === "OPTIONS" && found.allowed.length) {
        return new Response(null, { status: 204, headers: { allow: found.allowed.join(", ") } });
      }
      if (found.allowed.length) {
        const res = errorResponse(
          new HttpError(405, "method_not_allowed", `Méthode ${method} non autorisée sur ${path}.`),
        );
        res.headers.set("allow", found.allowed.join(", "));
        return res;
      }
      throw new HttpError(404, "not_found", `Ressource inconnue : ${path}.`);
    }

    const repo = await getRepository();
    const cookies = parseCookies(request.headers.get("cookie"));
    const user =
      (cookies[SESSION_COOKIE] ? await repo.users.get(cookies[SESSION_COOKIE]) : undefined) ??
      (await repo.users.get(DEFAULT_USER_ID));
    if (!user) throw new Error("Utilisateur par défaut absent du store");

    const { route, params } = found;
    const hasBody = method === "POST" || method === "PATCH" || method === "DELETE";
    const ctx: Ctx = {
      request,
      url,
      params,
      query: url.searchParams,
      repo,
      user,
      now: now(),
      body: hasBody && !route.multipart ? await readJson(request) : undefined,
      form: route.multipart ? await readForm(request) : null,
    };
    return await route.handler(ctx);
  } catch (error) {
    if (error instanceof HttpError) return errorResponse(error);
    console.error("[api] erreur interne", error);
    return json(
      { error: { code: "internal_error", message: "Erreur interne du serveur." } },
      { status: 500 },
    );
  }
}
