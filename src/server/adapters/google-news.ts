import { validateSourceUrl } from "../domain/security";

/**
 * Résolution des liens Google News. Le flux RSS ne donne que des redirections
 * `news.google.com/rss/articles/<id>` : l'adresse de l'article est encodée dans l'identifiant
 * (anciens liens) ou n'est connue que de Google, qui la rend par un appel interne non documenté
 * (liens depuis 2024). La résolution est opportuniste : en cas d'échec elle rend `null`.
 * La collecte n'ingère pas alors l'article, faute de page où vérifier la date originale.
 */
export interface LinkResolver {
  readonly name: string;
  /**
   * Adresse de l'article, ou `null` si le lien n'est pas une redirection Google News
   * ou ne se résout pas. `signal`, s'il est fourni, annule les requêtes de cette
   * tentative. Les implémentations qui l'ignorent restent valides.
   */
  resolve(url: string, signal?: AbortSignal): Promise<string | null>;
}

/** Hors production : rien n'est résolu (tests déterministes, hors réseau). */
export class NoopLinkResolver implements LinkResolver {
  readonly name = "liens-tels-quels";
  async resolve(): Promise<string | null> {
    return null;
  }
}

const ARTICLE_PATH = /^\/(?:rss\/)?articles\/([A-Za-z0-9_-]+)/;
const ARTICLE_PAGE = "https://news.google.com/articles/";
const DECODE_ENDPOINT = "https://news.google.com/_/DotsSplashUi/data/batchexecute";
const TIMEOUT_MS = 8_000;

/** Identifiant d'article d'une redirection Google News ; `null` pour toute autre adresse. */
export function googleNewsArticleId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname !== "news.google.com") return null;
    return ARTICLE_PATH.exec(u.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Adresse acceptable pour une observation : http(s), hors cibles internes, hors Google News. */
function acceptable(url: string): string | null {
  const check = validateSourceUrl(url);
  if (!check.ok || check.url.hostname === "news.google.com") return null;
  return check.url.toString();
}

/**
 * Anciens identifiants (avant 2024) : base64 d'un message protobuf qui contient l'adresse en clair.
 * Les nouveaux (`AU_yqL…` une fois décodés) ne contiennent rien d'exploitable.
 */
export function decodeEmbeddedUrl(id: string): string | null {
  let bytes: Uint8Array;
  try {
    const b64 = id.replace(/-/g, "+").replace(/_/g, "/");
    bytes = Uint8Array.from(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)), (c) =>
      c.charCodeAt(0),
    );
  } catch {
    return null;
  }
  const text = new TextDecoder("latin1").decode(bytes);
  if (text.includes("AU_yqL")) return null;
  // Caractères de contrôle et octets non ASCII bornent l'adresse (données binaires autour).
  // eslint-disable-next-line no-control-regex
  for (const m of text.matchAll(/https?:\/\/[^\s"'<>\x00-\x1f\x7f-\xff]+/g)) {
    const url = acceptable(m[0]);
    if (url) return url;
  }
  return null;
}

interface DecodeParams {
  signature: string;
  timestamp: string;
}

/** Jeton et horodatage de la page de l'article, nécessaires à l'appel interne. */
export function parseDecodeParams(html: string): DecodeParams | null {
  const signature = /data-n-a-sg="([^"]+)"/.exec(html)?.[1];
  const timestamp = /data-n-a-ts="(\d+)"/.exec(html)?.[1];
  return signature && timestamp ? { signature, timestamp } : null;
}

/** Corps `f.req` de l'appel interne (forme observée des clients ouverts qui décodent ces liens). */
export function decodeRequestBody(id: string, params: DecodeParams): string {
  const inner = JSON.stringify([
    "garturlreq",
    [
      [
        "en-US",
        "US",
        ["FINANCE_TOP_INDICES", "WEB_TEST_1_0_0"],
        null,
        null,
        1,
        1,
        "US:en",
        null,
        180,
        null,
        null,
        null,
        null,
        null,
        0,
        null,
        null,
        [1608992183, 723341000],
      ],
      "en-US",
      "US",
      1,
      [2, 3, 4, 8],
      1,
      0,
      "655000234",
      0,
      0,
      null,
      0,
    ],
    id,
    Number(params.timestamp),
    params.signature,
  ]);
  return `f.req=${encodeURIComponent(JSON.stringify([[["Fbv4je", inner, null, "generic"]]]))}`;
}

/** Adresse de l'article dans la réponse de l'appel interne (préfixe anti-JSON `)]}'` puis tableaux imbriqués). */
export function parseDecodeResponse(text: string): string | null {
  const start = text.indexOf("[");
  if (start < 0) return null;
  let outer: unknown;
  try {
    outer = JSON.parse(text.slice(start));
  } catch {
    // Réponse en plusieurs segments : on ne garde que le premier tableau complet.
    const line = text
      .slice(start)
      .split("\n")
      .find((l) => l.startsWith("[["));
    if (!line) return null;
    try {
      outer = JSON.parse(line);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(outer)) return null;
  for (const entry of outer) {
    if (!Array.isArray(entry)) continue;
    const payload = entry.find((v) => typeof v === "string" && v.includes("garturlres"));
    if (typeof payload !== "string") continue;
    try {
      const inner = JSON.parse(payload) as unknown;
      if (Array.isArray(inner) && typeof inner[1] === "string") return acceptable(inner[1]);
    } catch {
      return null;
    }
  }
  return null;
}

type Fetch = typeof fetch;

/**
 * Résolution réelle : d'abord l'adresse embarquée dans l'identifiant (sans réseau), sinon la page
 * de l'article puis l'appel interne (deux requêtes). Chaque requête est bornée par `TIMEOUT_MS`.
 * Un signal d'appelant, s'il est annulé, annule aussi ces requêtes, en-têtes et corps :
 * le second appel n'est pas lancé. Envoyer le signal ne ferme la connexion que si le
 * runtime honore `AbortSignal`.
 *
 * Cache : un appel sans signal partage sa promesse (en cours ou déjà rendue), y compris un
 * échec. Un appel annulable ne partage pas cette promesse : l'annuler ne doit ni écrire `null`
 * pour un article qui n'a pas abouti, ni annuler une autre tentative sur la même adresse.
 * Seul un résultat obtenu sans annulation est publié dans le cache.
 */
export class GoogleNewsLinkResolver implements LinkResolver {
  readonly name = "google-news-v1";
  private readonly cache = new Map<string, Promise<string | null>>();

  constructor(private readonly fetchImpl: Fetch = fetch) {}

  resolve(url: string, signal?: AbortSignal): Promise<string | null> {
    const id = googleNewsArticleId(url);
    if (!id) return Promise.resolve(null);
    const cached = this.cache.get(id);
    if (cached) return cached;
    if (signal?.aborted) return Promise.resolve(null);
    const pending = this.lookup(id, signal).catch((e: unknown) => {
      if (signal?.aborted) return null;
      console.error("[liens] résolution Google News impossible", (e as Error).message);
      return null;
    });
    if (!signal) this.remember(id, pending);
    else {
      void pending.then((value) => {
        if (signal.aborted || this.cache.has(id)) return;
        this.remember(id, Promise.resolve(value));
      });
    }
    return pending;
  }

  private remember(id: string, pending: Promise<string | null>): void {
    this.cache.set(id, pending);
    if (this.cache.size > 2000) this.cache.delete(this.cache.keys().next().value!);
  }

  private async lookup(id: string, signal?: AbortSignal): Promise<string | null> {
    const embedded = decodeEmbeddedUrl(id);
    if (embedded) return embedded;
    if (signal?.aborted) throw abortError();
    const page = await this.fetchOnce(
      `${ARTICLE_PAGE}${id}?hl=en-US&gl=US&ceid=US%3Aen`,
      { headers: { "user-agent": "Mozilla/5.0 (compatible; KORA-Newsroom/1.0)" } },
      signal,
    );
    if (signal?.aborted) throw abortError();
    if (page === null) return null;
    const params = parseDecodeParams(page);
    if (!params) return null;
    if (signal?.aborted) throw abortError();
    const decoded = await this.fetchOnce(
      DECODE_ENDPOINT,
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
          "user-agent": "Mozilla/5.0 (compatible; KORA-Newsroom/1.0)",
        },
        body: decodeRequestBody(id, params),
      },
      signal,
    );
    if (signal?.aborted) throw abortError();
    if (decoded === null) return null;
    return parseDecodeResponse(decoded);
  }

  /**
   * Délai de 8 s et signal d'appelant, tenus jusqu'à la fin du corps.
   * Les en-têtes ne lèvent ni le minuteur ni l'écouteur : une lecture bloquée
   * reste annulable. `null` signifie une réponse HTTP en erreur, corps non lu.
   * Une annulation est levée, pour ne pas être confondue avec cet échec.
   */
  private async fetchOnce(
    url: string,
    init: RequestInit,
    caller?: AbortSignal,
  ): Promise<string | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const onAbort = () => ctrl.abort();
    if (caller?.aborted) ctrl.abort();
    else caller?.addEventListener("abort", onAbort, { once: true });
    try {
      if (ctrl.signal.aborted) throw abortError();
      const res = await this.fetchImpl(url, { ...init, signal: ctrl.signal });
      if (ctrl.signal.aborted) {
        await res.body?.cancel().catch(() => undefined);
        throw abortError();
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        return null;
      }
      return await readBody(res, ctrl.signal);
    } finally {
      clearTimeout(timer);
      caller?.removeEventListener("abort", onAbort);
    }
  }
}

/**
 * Lit le corps tant que `signal` est actif. `Response.text()` verrouille le flux :
 * `body.cancel()` ne peut plus l'interrompre. Le reader, lui, s'annule.
 * Une fin de flux provoquée par cette annulation n'est pas un corps valide.
 */
async function readBody(res: Response, signal: AbortSignal): Promise<string> {
  if (!res.body) return "";
  if (signal.aborted) {
    await res.body.cancel().catch(() => undefined);
    throw abortError();
  }
  const reader = res.body.getReader();
  const stop = () => {
    void reader.cancel(abortError()).catch(() => undefined);
  };
  signal.addEventListener("abort", stop, { once: true });
  const decoder = new TextDecoder();
  let text = "";
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (signal.aborted) throw abortError();
        throw error;
      }
      if (signal.aborted) throw abortError();
      if (chunk.done) return text + decoder.decode();
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    signal.removeEventListener("abort", stop);
  }
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}
