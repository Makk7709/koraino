/**
 * Sécurité des contenus externes (§7) : filtrage des URL sortantes (SSRF) et nettoyage HTML.
 * Les contenus collectés sont des données non fiables : ils ne sont jamais interprétés comme
 * des instructions, seulement stockés et affichés comme du texte.
 */

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

const BLOCKED_SUFFIXES = [".local", ".internal", ".localhost", ".localdomain", ".home.arpa"];

function ipv4Blocked(parts: number[]): string | null {
  const [a = 0, b = 0, c = 0] = parts;
  if (a === 0) return "adresse non routable (0.0.0.0/8)";
  if (a === 10) return "réseau privé (10.0.0.0/8)";
  if (a === 127) return "adresse de bouclage (127.0.0.0/8)";
  if (a === 169 && b === 254) return "adresse lien-local (169.254.0.0/16)";
  if (a === 172 && b >= 16 && b <= 31) return "réseau privé (172.16.0.0/12)";
  if (a === 192 && b === 0 && c === 0) return "assignations IETF (192.0.0.0/24)";
  if (a === 192 && b === 0 && c === 2) return "assignations réseau de documentation (192.0.2.0/24)";
  if (a === 192 && b === 168) return "réseau privé (192.168.0.0/16)";
  if (a === 198 && (b === 18 || b === 19)) return "benchmark (198.18.0.0/15)";
  if (a === 198 && b === 51 && c === 100) return "réseau de documentation (198.51.100.0/24)";
  if (a === 203 && b === 0 && c === 113) return "réseau de documentation (203.0.113.0/24)";
  if (a === 100 && b >= 64 && b <= 127) return "réseau partagé opérateur (100.64.0.0/10)";
  if (a >= 224) return "adresse multicast ou réservée";
  return null;
}

function parseIpv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((p) => p >= 0 && p <= 255) ? parts : null;
}

function parseIpv6(host: string): number[] | null {
  let h = host.toLowerCase();
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(h);
  if (v4) {
    const dotted = v4[1] ?? "";
    const p = parseIpv4(dotted);
    if (!p) return null;
    const hi = (((p[0] ?? 0) << 8) | (p[1] ?? 0)).toString(16);
    const lo = (((p[2] ?? 0) << 8) | (p[3] ?? 0)).toString(16);
    h = `${h.slice(0, h.length - dotted.length)}${hi}:${lo}`;
  }
  const halves = h.split("::");
  if (halves.length > 2) return null;
  const parse = (s: string) =>
    s ? s.split(":").map((x) => (/^[0-9a-f]{1,4}$/.test(x) ? parseInt(x, 16) : Number.NaN)) : [];
  const head = parse(halves[0] ?? "");
  let all: number[];
  if (halves.length === 1) {
    all = head;
  } else {
    const rest = parse(halves[1] ?? "");
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return null;
    all = [...head, ...Array<number>(fill).fill(0), ...rest];
  }
  if (all.length !== 8 || all.some((x) => Number.isNaN(x))) return null;
  return all;
}

function ipv6Blocked(g: number[]): string | null {
  const [g0 = 0, , , , , g5 = 0, g6 = 0, g7 = 0] = g;
  if (g.every((x) => x === 0)) return "adresse non spécifiée (::)";
  if (g.slice(0, 7).every((x) => x === 0) && g7 === 1) return "adresse de bouclage (::1)";
  if ((g0 & 0xfe00) === 0xfc00) return "adresse locale unique (fc00::/7)";
  if ((g0 & 0xffc0) === 0xfe80) return "adresse lien-local (fe80::/10)";
  if ((g0 & 0xff00) === 0xff00) return "adresse multicast (ff00::/8)";

  if (g[0] === 0x0064 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0))
    return "préfixe NAT64 (64:ff9b::/96)";

  if (g0 === 0x2001 && g[1] === 0x0db8) return "documentation (2001:db8::/32)";
  if ((g0 & 0xffc0) === 0xfec0) return "local site (fec0::/10)";
  const mapped = g.slice(0, 5).every((x) => x === 0) && (g5 === 0xffff || g5 === 0);
  if (mapped) {
    const v4 = [g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff];
    const reason = ipv4Blocked(v4);
    if (reason) return `adresse IPv4 encapsulée : ${reason}`;
  }
  return null;
}

/** Contrôle d'un nom d'hôte (sans schéma) : refuse les cibles internes. */
export function checkHost(rawHost: string): string | null {
  const host = rawHost.toLowerCase().replace(/\.$/, "");
  if (!host) return "nom d'hôte vide";
  if (host.startsWith("[") || host.includes(":")) {
    const g = parseIpv6(host.replace(/^\[|\]$/g, ""));
    if (!g) return "adresse IPv6 invalide";
    return ipv6Blocked(g);
  }
  const v4 = parseIpv4(host);
  if (v4) return ipv4Blocked(v4);
  if (/^\d+$/.test(host) || /^0x/i.test(host)) return "adresse IP sous forme non standard";
  if (host === "localhost") return "hôte local (localhost)";
  for (const suffix of BLOCKED_SUFFIXES) {
    if (host.endsWith(suffix)) return `nom de domaine interne (${suffix})`;
  }
  if (!host.includes(".")) return "nom d'hôte non qualifié (réseau interne)";
  if (!/^[a-z0-9.-]+$/.test(host) || host.includes("..")) return "nom d'hôte invalide";
  return null;
}

/** Refuse les ports autres que 80 (http) et 443 (https). */
export function checkPort(url: URL): string | null {
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (!Number.isFinite(port)) return "port invalide";
  if (url.protocol === "http:" && port !== 80) {
    return `port ${port} non autorisé pour http (80 uniquement)`;
  }
  if (url.protocol === "https:" && port !== 443) {
    return `port ${port} non autorisé pour https (443 uniquement)`;
  }
  return null;
}

/** Validation d'une URL de source avant toute collecte. */
export function validateSourceUrl(raw: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "URL invalide" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      ok: false,
      reason: `protocole « ${url.protocol.replace(":", "")} » non autorisé (http/https uniquement)`,
    };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "identifiants intégrés à l'URL interdits" };
  }
  const portReason = checkPort(url);
  if (portReason) return { ok: false, reason: portReason };
  const reason = checkHost(url.hostname);
  if (reason) return { ok: false, reason };
  return { ok: true, url };
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  laquo: "«",
  raquo: "»",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  ndash: "–",
  mdash: "—",
  euro: "€",
  eacute: "é",
  egrave: "è",
  ecirc: "ê",
  euml: "ë",
  agrave: "à",
  acirc: "â",
  ccedil: "ç",
  ocirc: "ô",
  ucirc: "û",
  ugrave: "ù",
  icirc: "î",
  iuml: "ï",
  Eacute: "É",
  Egrave: "È",
  Agrave: "À",
  Ccedil: "Ç",
  oelig: "œ",
  deg: "°",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, ent: string) => {
    if (ent[0] === "#") {
      const code =
        ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return " ";
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[ent] ?? m;
  });
}

function stripTags(s: string): string {
  return s
    .replace(/<!--[\s\S]*?(-->|$)/g, " ")
    .replace(
      /<(script|style|iframe|object|embed|noscript|template|svg|math)\b[\s\S]*?(<\/\1\s*>|$)/gi,
      " ",
    )
    .replace(/<\/?[a-z!?][^>]*(>|$)/gi, " ");
}

/**
 * Nettoie un contenu HTML externe : supprime balises, scripts, styles et attributs,
 * décode les entités et renvoie du texte brut borné.
 */
export function sanitizeText(input: string, maxLength = 2000): string {
  let s = stripTags(input);
  s = decodeEntities(s);
  s = stripTags(s).replace(/[<>]/g, " ");
  s = s.replace(/\p{Cc}/gu, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s.length > maxLength ? `${s.slice(0, maxLength - 1)}…` : s;
}
