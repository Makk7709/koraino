import { FRESHNESS_DAYS } from "../adapters/collector";
import { DAY } from "../domain/dates";
import { readOriginalPublishedAt } from "../domain/original-date";
import { validateSourceUrl } from "../domain/security";

/** Même délai que la lecture d'un flux : une page lente n'est pas une date. */
const TIMEOUT_MS = 15_000;

/**
 * 1 Mio. Les dates utiles tiennent dans l'en-tête. Au-delà, la page est rejetée :
 * on ne la parse pas, même tronquée. Le plafond est appliqué en lisant le corps,
 * pas seulement en croyant `Content-Length`.
 */
export const MAX_PUBLISHER_HTML_BYTES = 1024 * 1024;

/**
 * Pourquoi la date d'un article n'est pas confirmée :
 * - `inaccessible` : adresse refusée, page qui ne répond pas, erreur HTTP, redirection,
 *   type autre que du HTML ou page de plus de `MAX_PUBLISHER_HTML_BYTES` ;
 * - `sans_date` : page lue, mais date de publication absente, illisible ou contradictoire ;
 * - `hors_fenetre` : date lue, mais hors de la fenêtre de fraîcheur.
 */
export type DateRejection = "inaccessible" | "sans_date" | "hors_fenetre";

/**
 * `refused` : le site a répondu par un refus d'accès (`REFUSAL_STATUSES`). L'appelant s'en sert
 * pour ne pas redemander les autres pages du même média pendant la collecte.
 */
export type PublishedAtCheck =
  { ok: true; publishedAt: string } | { ok: false; reason: DateRejection; refused: boolean };

/** Statuts HTTP par lesquels un site refuse la lecture : authentification, interdiction, débit. */
const REFUSAL_STATUSES = new Set([401, 403, 429]);

/**
 * Date originale confirmée par la page éditeur, dans la fenêtre de fraîcheur, ou le motif
 * du refus : l'appelant le rapporte dans l'historique des collectes.
 *
 * `budgetMs` borne cette lecture (le délai propre de 15 s reste un maximum).
 * Les redirections ne sont pas suivies (`redirect: "manual"`). Ce choix n'est
 * réel que si le runtime — Node, ou le worker Cloudflare qui héberge Nitro —
 * rend la réponse 3xx au lieu de la suivre avant notre code.
 *
 * SSRF : `validateSourceUrl` juge le nom écrit dans l'URL (IP littérale, localhost,
 * suffixes internes). Il n'y a pas de résolution DNS ici. Un nom public qui pointe
 * vers une adresse privée, ou un rebinding entre le contrôle et la connexion, n'est
 * pas détecté par l'application. Une protection de ce genre, si elle existe, est
 * celle du réseau Cloudflare, pas une garantie de ce module.
 */
export async function checkPublishedAt(
  url: string,
  now: Date,
  budgetMs = TIMEOUT_MS,
): Promise<PublishedAtCheck> {
  if (budgetMs <= 0) return { ok: false, reason: "inaccessible", refused: false };
  const page = await fetchPublisherHtml(url, Math.min(TIMEOUT_MS, budgetMs));
  if (page.html === null) return { ok: false, reason: "inaccessible", refused: page.refused };
  const original = readOriginalPublishedAt(page.html);
  if (!original) return { ok: false, reason: "sans_date", refused: false };
  if (!isFresh(original, now)) return { ok: false, reason: "hors_fenetre", refused: false };
  return { ok: true, publishedAt: original };
}

function isFresh(iso: string, now: Date): boolean {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  const cutoff = now.getTime() - FRESHNESS_DAYS * DAY;
  const future = now.getTime() + DAY;
  return t >= cutoff && t <= future;
}

type PublisherPage = { html: string } | { html: null; refused: boolean };

const UNREADABLE: PublisherPage = { html: null, refused: false };

async function fetchPublisherHtml(url: string, timeoutMs: number): Promise<PublisherPage> {
  if (timeoutMs <= 0) return UNREADABLE;
  const check = validateSourceUrl(url);
  if (!check.ok || check.url.hostname === "news.google.com") return UNREADABLE;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(check.url.toString(), {
      redirect: "manual",
      signal: ctrl.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; KORA-Newsroom/1.0)",
        accept: "text/html,application/xhtml+xml;q=0.9",
      },
    });
    if (res.status >= 300 && res.status < 400) return UNREADABLE;
    if (!res.ok) return { html: null, refused: REFUSAL_STATUSES.has(res.status) };
    if (!acceptableHtmlType(res.headers.get("content-type"))) {
      await res.body?.cancel().catch(() => undefined);
      return UNREADABLE;
    }
    const declared = declaredLength(res);
    if (declared !== null && declared > MAX_PUBLISHER_HTML_BYTES) {
      await res.body?.cancel().catch(() => undefined);
      return UNREADABLE;
    }
    const html = await readCappedHtml(res);
    return html === null ? UNREADABLE : { html };
  } catch {
    return UNREADABLE;
  } finally {
    clearTimeout(timer);
  }
}

/** Type absent : on lit quand même. Type présent et autre que du HTML : on refuse. */
function acceptableHtmlType(header: string | null): boolean {
  if (header === null) return true;
  const mime = header.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!mime) return true;
  return mime === "text/html" || mime === "application/xhtml+xml";
}

function declaredLength(res: Response): number | null {
  const raw = res.headers.get("content-length");
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

async function readCappedHtml(res: Response): Promise<string | null> {
  const body = res.body;
  if (!body) return cappedText(await res.text());
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      if (received + value.byteLength > MAX_PUBLISHER_HTML_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
      received += value.byteLength;
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return null;
  }
  if (received === 0) return "";
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

function cappedText(text: string): string | null {
  return new TextEncoder().encode(text).byteLength > MAX_PUBLISHER_HTML_BYTES ? null : text;
}
