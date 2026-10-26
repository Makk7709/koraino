import { validateSourceUrl } from "../domain/security";

/**
 * Résolution des liens Google News. Le flux RSS ne donne que des redirections
 * `news.google.com/rss/articles/<id>` : l'adresse de l'article est encodée dans l'identifiant
 * (anciens liens) ou n'est connue que de Google, qui la rend par un appel interne non documenté
 * (liens depuis 2024). La résolution est opportuniste : en cas d'échec, l'observation garde la
 * redirection, comme avant.
 */
export interface LinkResolver {
  readonly name: string;
  /** Adresse de l'article, ou `null` si le lien n'est pas une redirection Google News ou ne se résout pas. */
  resolve(url: string): Promise<string | null>;
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
 * de l'article puis l'appel interne (deux requêtes). Les résultats sont gardés en mémoire le temps
 * du processus, et toute erreur rend `null` : la collecte n'en dépend jamais.
 */
export class GoogleNewsLinkResolver implements LinkResolver {
  readonly name = "google-news-v1";
  private readonly cache = new Map<string, Promise<string | null>>();

  constructor(private readonly fetchImpl: Fetch = fetch) {}

  resolve(url: string): Promise<string | null> {
    const id = googleNewsArticleId(url);
    if (!id) return Promise.resolve(null);
    let pending = this.cache.get(id);
    if (!pending) {
      pending = this.lookup(id).catch((e: unknown) => {
        console.error("[liens] résolution Google News impossible", (e as Error).message);
        return null;
      });
      this.cache.set(id, pending);
      if (this.cache.size > 2000) this.cache.delete(this.cache.keys().next().value!);
    }
    return pending;
  }

  private async lookup(id: string): Promise<string | null> {
    const embedded = decodeEmbeddedUrl(id);
    if (embedded) return embedded;
    const page = await this.fetchImpl(`${ARTICLE_PAGE}${id}?hl=en-US&gl=US&ceid=US%3Aen`, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; KORA-Newsroom/1.0)" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!page.ok) return null;
    const params = parseDecodeParams(await page.text());
    if (!params) return null;
    const res = await this.fetchImpl(DECODE_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        "user-agent": "Mozilla/5.0 (compatible; KORA-Newsroom/1.0)",
      },
      body: decodeRequestBody(id, params),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return parseDecodeResponse(await res.text());
  }
}
