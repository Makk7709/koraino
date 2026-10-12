import type { ApiErrorBody } from "@/lib/api/types";

/** Erreur métier convertie en réponse `ApiErrorBody` (jamais de stack trace côté client). */
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new HttpError(400, code, message, details);
export const forbidden = (message: string, code = "forbidden") => new HttpError(403, code, message);
export const notFound = (message: string) => new HttpError(404, "not_found", message);
export const conflict = (code: string, message: string, details?: unknown) =>
  new HttpError(409, code, message, details);
export const unprocessable = (code: string, message: string, details?: unknown) =>
  new HttpError(422, code, message, details);

export function json(data: unknown, init: { status?: number; headers?: HeadersInit } = {}) {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "no-store");
  return Response.json(data, { status: init.status ?? 200, headers });
}

export function noContent(headers: HeadersInit = {}) {
  return new Response(null, { status: 204, headers });
}

export function errorResponse(error: HttpError): Response {
  const body: ApiErrorBody = { error: { code: error.code, message: error.message } };
  if (error.details !== undefined) body.error.details = error.details;
  return json(body, { status: error.status });
}

/** Fichier téléchargeable (exports CSV/JSON/HTML/TXT). */
export function fileResponse(
  content: string,
  opts: { filename: string; contentType: string; bom?: boolean },
): Response {
  const body = opts.bom ? `\uFEFF${content}` : content;
  const ascii = opts.filename.replace(/[^\w.-]+/g, "_");
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": opts.contentType,
      "content-disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(opts.filename)}`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

export const SESSION_COOKIE = "kora_uid";

export function sessionCookie(userId: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(userId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
}
