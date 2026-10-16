import type {
  Category,
  CollectionEnrichment,
  ContentAssessment,
  ObservationVia,
  Outlet,
} from "@/lib/api/types";
import { slugify } from "../domain/text";
import {
  CITIES,
  COUNTRIES,
  EVENT_TEMPLATES,
  LOCAL_OUTLETS,
  NAME_SUFFIXES,
  NATIONAL_MEDIA,
  OUTLETS,
  PRIZES,
} from "../store/catalog";
import { hash32 } from "../store/prng";
import type { CompanyRecord, SourceRecord } from "../store/records";
import { safeFetchText } from "../domain/safeHttp";

/** Élément brut renvoyé par un collecteur (HTML non fiable, nettoyé ensuite). */
export interface RawItem {
  url: string;
  title: string;
  html: string;
  outlet: Outlet;
  publishedAt: string | null;
  eventDate: string | null;
  via?: ObservationVia;
  /** Lecture du contenu par le modèle, ajoutée par le service de collecte avant l'ingestion. */
  assessment?: ContentAssessment;
}

/** Bilan de la recherche complémentaire, avant le décompte des observations créées. */
export type EnrichmentOutcome = Omit<CollectionEnrichment, "added">;

/** Incident sans échec de la collecte (ex. Google News indisponible, Perplexity a répondu). */
export interface CollectWarning {
  code: string;
  reason: string;
}

export type CollectResult =
  | { ok: true; items: RawItem[]; enrichment?: EnrichmentOutcome; warning?: CollectWarning }
  | { ok: false; code: string; reason: string; transient: boolean };

/** Âge maximal (jours) d'une publication datée retenue par la collecte réelle. */
export const FRESHNESS_DAYS = 30;

const NO_FEED_REASON =
  "Aucun flux RSS annoncé sur cette page, ni aux adresses habituelles (/feed/, /rss, /feed.xml, /rss.xml) : rien à collecter. Indiquez l'adresse du flux ou d'une page d'actualités.";

/** Adresses de flux essayées quand une page n'en annonce aucun (WordPress, Hugo, Jekyll, Ghost…). */
export const FEED_PROBES = ["/feed/", "/rss", "/feed.xml", "/rss.xml"] as const;

export interface CollectInput {
  source: SourceRecord;
  company: CompanyRecord | null;
  /** Essai en cours (1 à 3). */
  attempt: number;
  now: Date;
  /** Derniers événements connus de l'entreprise (pour simuler les reprises). */
  knownEvents: { title: string; excerpt: string }[];
}

export interface Collector {
  readonly name: string;
  collect(input: CollectInput): CollectResult | Promise<CollectResult>;
}

const CATEGORIES: Category[] = [
  "financement",
  "partenariat",
  "innovation",
  "produit",
  "contrat",
  "recrutement",
  "croissance",
  "international",
  "distinction",
  "brevet",
  "recherche",
  "acquisition",
];

/**
 * Collecte simulée et déterministe : selon la source et son numéro d'exécution, elle renvoie
 * de nouvelles publications, aucune actualité, ou un échec (code HTTP_403, TIMEOUT…).
 * Aucune actualité n'est inventée sur une entreprise réelle : seules les entreprises fictives
 * du jeu de démonstration reçoivent des événements générés.
 */
export class SimulatedCollector implements Collector {
  readonly name = "collecteur-simule-v1";

  collect(input: CollectInput): CollectResult {
    const { source, attempt } = input;
    const sim = source.simulation;
    if (sim.mode === "fail")
      return { ok: false, code: sim.code, reason: sim.reason, transient: false };
    if (sim.mode === "empty") return { ok: true, items: [] };
    if (sim.mode === "transient" && attempt === 1) {
      return { ok: false, code: "TIMEOUT", reason: "Délai de réponse dépassé", transient: true };
    }
    if (sim.mode === "news") return { ok: true, items: this.generate(input, true) };

    const h = hash32(`${source.id}:${source.runCount}`) % 100;
    if (h >= 22 && h < 26 && attempt === 1) {
      return { ok: false, code: "TIMEOUT", reason: "Délai de réponse dépassé", transient: true };
    }
    if (h < 22) return { ok: true, items: this.generate(input, false) };
    return { ok: true, items: [] };
  }

  private generate(input: CollectInput, force: boolean): RawItem[] {
    const { company, source, now } = input;
    if (!company) return [];
    const seed = hash32(`${source.id}:${source.runCount}:news`);
    const at = new Date(now.getTime() - ((seed % 300) + 30) * 60_000).toISOString();

    const latest = input.knownEvents[0];
    if (!company.fictional) {
      if (!latest) return [];
      return [
        {
          url: `https://www.${OUTLETS.dauphine.domain}/economie/${slugify(latest.title)}-${seed % 100000}`,
          title: latest.title,
          html: `<article><p>${latest.excerpt}</p></article>`,
          outlet: OUTLETS.dauphine,
          publishedAt: at,
          eventDate: null,
        },
      ];
    }

    if (latest && seed % 3 === 0 && !force) {
      const outlet = LOCAL_OUTLETS[seed % LOCAL_OUTLETS.length]!;
      return [
        {
          url: `https://www.${outlet.domain}/actualite/${slugify(latest.title)}-${seed % 100000}`,
          title: latest.title,
          html: `<div class="article"><p>${latest.excerpt}</p></div>`,
          outlet,
          publishedAt: at,
          eventDate: null,
        },
      ];
    }

    const spec = NAME_SUFFIXES.find((s) => company.name.endsWith(s.s)) ?? NAME_SUFFIXES[0]!;
    const category = CATEGORIES[seed % CATEGORIES.length]!;
    const text = EVENT_TEMPLATES[category]({
      company: company.name,
      partner: "un industriel européen",
      amount: 3 + (seed % 25),
      count: 10 + (seed % 40),
      topic: spec.topic,
      product: spec.products[seed % spec.products.length]!,
      country: COUNTRIES[seed % COUNTRIES.length]!,
      city: CITIES[seed % CITIES.length]!,
      prize: PRIZES[seed % PRIZES.length]!,
    });
    const fromCompany =
      source.type === "site_officiel" || source.type === "communiques" || source.type === "rss";
    const outlet: Outlet = fromCompany
      ? { name: company.name, domain: company.domain, brand: company.brand }
      : (seed % 2 === 0 ? LOCAL_OUTLETS : NATIONAL_MEDIA)[seed % 3]!;
    const unknownDate = seed % 9 === 0;
    return [
      {
        url: fromCompany
          ? `https://www.${company.domain}/actualites/${slugify(text.title)}`
          : `https://www.${outlet.domain}/actualite/${slugify(text.title)}-${seed % 100000}`,
        title: text.title,
        html: `<article><h1>${text.title}</h1><p>${fromCompany ? text.communique : text.media}</p></article>`,
        outlet,
        publishedAt: unknownDate ? null : at,
        eventDate: null,
      },
    ];
  }
}

/** Nom et alias d'une entreprise, dédoublonnés, pour les requêtes par nom. */
export function companyNames(company: Pick<CompanyRecord, "name" | "aliases">): string[] {
  const seen = new Set<string>();
  return [company.name, ...company.aliases]
    .map((n) => n.trim())
    .filter((n) => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()));
}

/** Expression exacte par nom, les alias en alternative (`"Bertin Alpao" OR "Alpao"`). */
export function quotedNames(names: string | string[]): string {
  return (Array.isArray(names) ? names : [names]).map((n) => `"${n}"`).join(" OR ");
}

/** Lien Google News (flux RSS) pour une recherche par nom d'entreprise, alias compris. */
export function googleNewsUrl(query: string | string[]): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(quotedNames(query))}&hl=fr&gl=FR&ceid=FR:fr`;
}

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1]!) : null;
}

function brandFor(name: string): Outlet["brand"] {
  const letters = name
    .replace(/[^A-Za-zÀ-ÿ ]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  const initials = (
    letters
      .map((w) => w[0])
      .join("")
      .slice(0, 2) || "?"
  ).toUpperCase();
  return { initials, bg: "oklch(0.92 0.02 250)", fg: "oklch(0.3 0.05 250)" };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Un document est un flux s'il s'ouvre sur `<rss`, `<feed` ou `<rdf:RDF`. */
export function isFeed(text: string): boolean {
  return /<(rss|feed|rdf:RDF)[\s>]/i.test(text);
}

/** Analyse un flux RSS 2.0 ou Atom. */
export function parseFeed(xml: string, fallbackOutlet: Outlet): RawItem[] {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  const items: RawItem[] = [];
  for (const b of blocks) {
    const title = tag(b, "title");
    let link = tag(b, "link");
    if (!link) link = b.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? null;
    if (!title || !link) continue;
    const date = tag(b, "pubDate") ?? tag(b, "published") ?? tag(b, "updated");
    const parsed = date ? new Date(date) : null;
    const desc = tag(b, "description") ?? tag(b, "summary") ?? tag(b, "content") ?? "";
    const sourceName = tag(b, "source");
    const sourceUrl = b.match(/<source[^>]*url="([^"]+)"/i)?.[1];
    const outlet: Outlet = sourceName
      ? { name: sourceName, domain: hostOf(sourceUrl ?? link), brand: brandFor(sourceName) }
      : fallbackOutlet;
    let cleanTitle = title;
    if (sourceName && cleanTitle.endsWith(` - ${sourceName}`))
      cleanTitle = cleanTitle.slice(0, -(sourceName.length + 3));
    items.push({
      url: link,
      title: cleanTitle,
      html: `<article><h1>${cleanTitle}</h1><p>${desc}</p></article>`,
      outlet,
      publishedAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null,
      eventDate: null,
    });
  }
  return items;
}

interface PerplexityResult {
  title?: string;
  url?: string;
  snippet?: string;
  date?: string | null;
  /** Dernière mise à jour de la page, en repli de `date` (les deux sont facultatifs dans l'API). */
  last_updated?: string | null;
}

/** Texte comparable : minuscules, sans accents, espaces et apostrophes normalisés. */
function comparable(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const INDEX_TITLE_PATTERNS = [
  /\bpage\s+\d+(?:\s*(?:of|sur|\/)\s*\d+)?\b/i,
  /^(?:actualit[ée]s?|news|blog|innovation|[ée]conomie|entreprises?|rubriques?|tags?|cat[ée]gories?|archives?|th[ée]matiques?|dossiers?|r[ée]sultats? de recherche|search results?)\s*(?:[-|–—:]|$)/i,
  /\b(?:tous les articles|all articles|toutes les actualit[ée]s|derni[èe]res actualit[ée]s|latest news|recent news)\b/i,
  /\bsitemap\b/i,
  /^(?:th[ée]matiques?|dossiers?|rubriques?|tags?|cat[ée]gories?|archives?)\b/i,
];
const INDEX_PATH_PATTERN =
  /\/(?:tags?|categor(?:y|ies|ie|ies)|rubriques?|archives?|search|recherche|page\/\d+|sitemap|feed|rss|author|auteur)(?:\/|$)|[?&](?:page|paged|p|s|q|search)=/i;

/**
 * Page de rubrique, de liste ou de pagination plutôt qu'article : titre réduit à un nom de
 * rubrique (« Innovation - Le Dauphiné Libéré »), pagination (« page 970 of 1107 »), ou adresse
 * de catégorie, d'étiquette ou de recherche. Ces pages citent l'entreprise sans parler d'elle.
 */
export function looksLikeIndexPage(title: string, url: string): boolean {
  const t = title.trim();
  if (INDEX_TITLE_PATTERNS.some((re) => re.test(t))) return true;
  const [head = "", ...rest] = t.split(/\s+[-|–—:]\s+/);
  const headWords = head.split(/\s+/).filter(Boolean).length;
  if (rest.length > 0 && headWords <= 2 && t.split(/\s+/).length <= 6) return true;
  try {
    const u = new URL(url);
    return INDEX_PATH_PATTERN.test(`${u.pathname}${u.search}`);
  } catch {
    return false;
  }
}

/**
 * Résultats Perplexity retenus, au format des éléments collectés : publications datées, hors
 * site de l'entreprise (couvert par ses propres sources), qui la citent. Les pages sans date
 * de publication ni de mise à jour (annuaires, pages produit) et les pages de rubrique, de liste
 * ou de pagination ne sont pas des actualités.
 */
export function mapPerplexityResults(
  results: PerplexityResult[],
  company: CompanyRecord,
): RawItem[] {
  const names = companyNames(company).map(comparable);
  const ownSite = (host: string) =>
    !!company.domain && (host === company.domain || host.endsWith(`.${company.domain}`));
  return results.flatMap((r) => {
    if (!r.url || !r.title) return [];
    const host = hostOf(r.url);
    const dated = r.date ?? r.last_updated;
    const d = dated ? new Date(dated) : null;
    if (!host || ownSite(host) || !d || Number.isNaN(d.getTime())) return [];
    if (looksLikeIndexPage(r.title, r.url)) return [];
    const text = comparable(`${r.title} ${r.snippet ?? ""}`);
    if (!names.some((n) => text.includes(n))) return [];
    return [
      {
        url: r.url,
        title: r.title,
        html: `<article><h1>${r.title}</h1><p>${r.snippet ?? ""}</p></article>`,
        outlet: { name: host, domain: host, brand: brandFor(host) },
        publishedAt: d.toISOString(),
        eventDate: null,
        via: "perplexity" as const,
      },
    ];
  });
}

function titleKey(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Ajoute en tête les résultats complémentaires absents des éléments déjà collectés. Google News
 * renvoie des liens de redirection : un même article se reconnaît aussi à son titre.
 */
export function mergeEnrichment(items: RawItem[], extra: RawItem[]): RawItem[] {
  const urls = new Set(items.map((i) => i.url));
  const titles = items.map((i) => titleKey(i.title));
  const sameStory = (key: string) =>
    titles.some(
      (t) => Math.min(t.length, key.length) >= 25 && (t.startsWith(key) || key.startsWith(t)),
    );
  return [...extra.filter((i) => !urls.has(i.url) && !sameStory(titleKey(i.title))), ...items];
}

/** Nombre de résultats demandés à Perplexity (10 par défaut dans l'API, 20 au plus). */
export const PERPLEXITY_MAX_RESULTS = 10;

/**
 * Requête Perplexity Search : le nom et les alias en expressions exactes, la presse française
 * d'abord (`country`, langues), le site de l'entreprise exclu (il est couvert par ses propres
 * sources), le dernier mois seulement.
 */
export function perplexityRequest(company: CompanyRecord): Record<string, unknown> {
  return {
    query: `${quotedNames(companyNames(company))} actualité`,
    max_results: PERPLEXITY_MAX_RESULTS,
    country: "FR",
    search_language_filter: ["fr", "en"],
    search_recency_filter: "month",
    ...(company.domain ? { search_domain_filter: [`-${company.domain}`] } : {}),
  };
}

/**
 * Recherche Perplexity (via la passerelle) : résultats web du dernier mois sur l'entreprise.
 * Ne lève jamais : un échec n'interrompt pas la collecte Google News, il est consigné.
 */
export async function perplexitySearch(
  company: CompanyRecord,
  env: Record<string, string | undefined>,
): Promise<{ items: RawItem[]; outcome: EnrichmentOutcome }> {
  const outcome = (
    status: EnrichmentOutcome["status"],
    message: string | null,
    received = 0,
    items: RawItem[] = [],
  ) => ({
    items,
    outcome: { provider: "perplexity" as const, status, received, matched: items.length, message },
  });
  const lovableKey = env["LOVABLE_API_KEY"];
  const pplxKey = env["PERPLEXITY_API_KEY"];
  if (!lovableKey || !pplxKey) {
    const missing = [!lovableKey && "LOVABLE_API_KEY", !pplxKey && "PERPLEXITY_API_KEY"].filter(
      Boolean,
    );
    return outcome("non_configure", `Secret manquant : ${missing.join(", ")}`);
  }
  try {
    const res = await fetch("https://connector-gateway.lovable.dev/perplexity/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": pplxKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(perplexityRequest(company)),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const body = (await res.text()).replace(/\s+/g, " ").slice(0, 200);
      console.error(`Perplexity search failed [${res.status}]: ${body}`);
      return outcome("erreur", `HTTP ${res.status}${body ? ` : ${body}` : ""}`);
    }
    const data = (await res.json()) as { results?: PerplexityResult[] };
    const results = data.results ?? [];
    return outcome("ok", null, results.length, mapPerplexityResults(results, company));
  } catch (e) {
    console.error("Perplexity search error", e);
    const err = e as Error;
    return outcome(
      "erreur",
      err.name === "TimeoutError" ? "Délai de réponse dépassé" : err.message,
    );
  }
}

/**
 * Collecte réelle : lit le flux RSS/Atom de la source (ou le découvre depuis la page HTML),
 * et interroge Google News pour les sources « recherche web » / « actualités ».
 */
export class RealCollector implements Collector {
  readonly name = "collecteur-rss-google-v1";

  /** Recherches Perplexity de l'exécution en cours, par source : une seule par exécution, essais compris. */
  private readonly searches = new WeakMap<Date, Map<string, ReturnType<typeof perplexitySearch>>>();

  constructor(private readonly env: Record<string, string | undefined> = process.env) {}

  /** Recherche Perplexity mémoïsée sur la date d'exécution : un réessai ne la relance pas. */
  private search(company: CompanyRecord, source: SourceRecord, now: Date) {
    let bySource = this.searches.get(now);
    if (!bySource) {
      bySource = new Map();
      this.searches.set(now, bySource);
    }
    let pending = bySource.get(source.id);
    if (!pending) {
      pending = perplexitySearch(company, this.env);
      bySource.set(source.id, pending);
    }
    return pending;
  }

  async collect(input: CollectInput): Promise<CollectResult> {
    const { source, company } = input;
    const useGoogle =
      source.type === "recherche_web" ||
      (source.type === "actualites" && !/rss|feed|atom|xml/i.test(source.url));
    // Source presse d'une entreprise : la requête suit le nom courant et les alias, pas l'URL
    // enregistrée à la création (renommage, alias ajoutés depuis).
    const url = useGoogle
      ? company
        ? googleNewsUrl(companyNames(company))
        : source.url.includes("news.google.com")
          ? source.url
          : googleNewsUrl(source.label)
      : source.url;
    const fallback: Outlet = company
      ? { name: company.name, domain: company.domain, brand: company.brand }
      : { name: hostOf(url), domain: hostOf(url), brand: brandFor(hostOf(url)) };
    const search = useGoogle && company ? this.search(company, source, input.now) : null;

    let items: RawItem[];
    let warning: CollectWarning | undefined;
    try {
      const feed = await this.readFeed(url, fallback);
      // Page sans flux, même aux adresses habituelles : échec définitif, visible sur la source
      // (et non un succès silencieux), jusqu'à ce que son adresse soit corrigée.
      if (!feed) return { ok: false, code: "NO_FEED", reason: NO_FEED_REASON, transient: false };
      const via: ObservationVia = useGoogle ? "google_news" : "flux";
      items = feed.map((i) => ({ ...i, via }));
    } catch (e) {
      const err = e as Error & { code?: string };
      const failure = {
        ok: false as const,
        code: err.code ?? "NETWORK",
        reason: err.message || "Erreur réseau",
        transient: err.code !== "HTTP_403" && err.code !== "HTTP_404",
      };
      // Google News indisponible : la recherche Perplexity suffit à mener la collecte.
      if (!search || (await search).outcome.status !== "ok") return failure;
      items = [];
      warning = { code: failure.code, reason: `Google News : ${failure.reason}` };
    }

    let enrichment: EnrichmentOutcome | undefined;
    if (search) {
      const extra = await search;
      enrichment = extra.outcome;
      items = mergeEnrichment(items, extra.items);
    }
    if (company && !useGoogle) {
      // Flux généraliste : ne garder que ce qui mentionne l'entreprise ou un alias,
      // sauf si le flux est celui de l'entreprise elle-même.
      const own = hostOf(url).endsWith(company.domain);
      if (!own) {
        const names = [company.name, ...company.aliases].map((n) => n.toLowerCase());
        items = items.filter((i) =>
          names.some((n) => `${i.title} ${i.html}`.toLowerCase().includes(n)),
        );
      }
    }
    const cutoff = input.now.getTime() - FRESHNESS_DAYS * 86_400_000;
    // Sans date de publication, la fraîcheur n'est pas vérifiable. Certains flux (agendas
    // d'événements) mettent la date de l'événement à venir à sa place : une date future non plus.
    const future = input.now.getTime() + 86_400_000;
    items = items.filter((i) => {
      const t = i.publishedAt ? new Date(i.publishedAt).getTime() : NaN;
      return t >= cutoff && t <= future;
    });
    items.sort((a, b) => b.publishedAt!.localeCompare(a.publishedAt!));
    return {
      ok: true,
      items,
      ...(enrichment ? { enrichment } : {}),
      ...(warning ? { warning } : {}),
    };
  }

  /** Éléments du flux ; null si la page n'est pas un flux et n'en annonce aucun. */
  private async readFeed(url: string, fallback: Outlet): Promise<RawItem[] | null> {

    let text = await this.fetchText(url);
    if (!isFeed(text)) {
      const alt = text.match(/<link[^>]+type="application\/(?:rss|atom)\+xml"[^>]*>/i)?.[0];
      const href = alt?.match(/href="([^"]+)"/i)?.[1];
      if (href) {
        text = await this.fetchText(new URL(href, url).toString());
      } else {
        const probed = await this.probeFeed(url);
        if (!probed) return null;
        text = probed;
      }
    }
    return parseFeed(text, fallback);
  }

  /** Flux aux adresses habituelles du site, quand la page n'en annonce aucun ; null sinon. */
  private async probeFeed(pageUrl: string): Promise<string | null> {
    const origin = new URL(pageUrl).origin;
    for (const path of FEED_PROBES) {
      try {
        const text = await this.fetchText(`${origin}${path}`);
        if (isFeed(text)) return text;
      } catch {
        // Adresse absente ou injoignable : on essaie la suivante.
      }
    }
    return null;
  }

  private async fetchText(url: string): Promise<string> {
    return safeFetchText(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; KORA-Newsroom/1.0)",
        accept: "application/rss+xml, application/atom+xml, text/xml, text/html;q=0.8",
      },
    });
  }
}
