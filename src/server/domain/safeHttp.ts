/**
 * Requêtes HTTP sortantes sûres (SSRF) : validation à chaque URL, redirections manuelles,
 * corps lu en flux avec plafond d'octets.
 */
import { validateSourceUrl } from "./security";

export const SAFE_FETCH_DEFAULTS = {
  timeoutMs: 15_000,
  maxBytes: 2 * 1024 * 1024,
  maxRedirects: 5,
} as const;

export type SafeFetchTextOptions = {
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  allowedHost?: string;
};

// Sert à comparer qu'une URL est bien celle du site qu'on souhaite atteindre
function assertAllowedHost(urlString: string, allowedHost: string): boolean {
  const host = normalizeHostname(urlString);
  const allowed = normalizeHostname(allowedHost);

  return host !== "" && allowed !== "" && host === allowed;
}

function normalizeHostname(value: string): string {
  const input = value.trim();

  let hostname: string;
  try {
    hostname = input.includes("://")
      ? new URL(input).hostname
      : new URL(`https://${input}`).hostname;
  } catch {
    return "";
  }

  // Normalise la casse et le point DNS final.
  return hostname
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");
}

function httpError(code: string, message: string): Error & { code: string } {
  const e = new Error(message) as Error & { code: string };
  e.code = code;
  return e;
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function readBodyLimited(
  res: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<string> {
  const len = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(len) && len > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw httpError("BODY_TOO_LARGE", "Réponse trop volumineuse");
  }
  if (!res.body) return "";

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    for (;;) {
      if (signal?.aborted) {
        throw signal.reason ?? httpError("TIMEOUT", "Délai de réponse dépassé");
      }
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        throw httpError("BODY_TOO_LARGE", "Réponse trop volumineuse");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

/**
 * GET texte : valide l'URL, ne suit pas les redirections implicitement,
 * re-valide chaque Location, limite taille et délai.
 */
export async function safeFetchText(
  rawUrl: string,
  options: SafeFetchTextOptions = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? SAFE_FETCH_DEFAULTS.timeoutMs;
  const maxBytes = options.maxBytes ?? SAFE_FETCH_DEFAULTS.maxBytes;
  const maxRedirects = options.maxRedirects ?? SAFE_FETCH_DEFAULTS.maxRedirects;
  const headers = options.headers ?? {};
  const allowedHost = options.allowedHost ?? rawUrl;

  let current = rawUrl;
  let redirectsFollowed = 0;

  for (;;) {
    const signal = AbortSignal.timeout(timeoutMs);
    const check = validateSourceUrl(current);
    if (!check.ok) {
      throw httpError("URL_REFUSED", check.reason);
    }

    let res: Response;
    try {
      if (!assertAllowedHost(current, allowedHost)) {
        throw httpError("HOST_MISMATCH", "Hôte différent de la source");
      }
      res = await fetch(check.url, {
        method: "GET",
        redirect: "manual",
        headers,
        signal,
      });
    } catch (e) {
      const err = e as Error;
      if (err.name === "TimeoutError" || err.name === "AbortError") {
        throw httpError("TIMEOUT", "Délai de réponse dépassé");
      }
      throw e;
    }

    if (isRedirectStatus(res.status)) {
      await res.body?.cancel().catch(() => {});
      if (redirectsFollowed >= maxRedirects) {
        throw httpError("TOO_MANY_REDIRECTS", "Trop de redirections");
      }
      const location = res.headers.get("location");
      if (!location?.trim()) {
        throw httpError("REDIRECT_NO_LOCATION", "Redirection sans en-tête Location");
      }
      current = new URL(location, check.url).toString();
      const next = validateSourceUrl(current);
      if (!next.ok) throw httpError("URL_REFUSED", next.reason);

      redirectsFollowed += 1;
      continue;
    }

    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw httpError(`HTTP_${res.status}`, `Réponse HTTP ${res.status}`);
    }
    try {
      return await readBodyLimited(res, maxBytes, signal);
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === "BODY_TOO_LARGE") throw e;
      if (err.name === "TimeoutError" || err.name === "AbortError") {
        throw httpError("TIMEOUT", "Délai de réponse dépassé");
      }
      throw e;
    }
  }
}
